/**
 * runtime-bridge — bidirectional mapping between tldraw shape IDs and
 * @svg-os/core Runtime node IDs.
 *
 * The runtime owns execution. The canvas owns interaction and presentation.
 */

import { getNodeType as getTemplateType, renderTemplateInline } from "@svg-os/bridge";
import type { Runtime } from "@svg-os/core";
import type { Editor } from "tldraw";
import { getApiKey, getModel } from "./claude-api";

type ShapeRecord = {
  id: string;
  type: string;
  x: number;
  y: number;
  props: Record<string, unknown>;
};

type BindingRecord = {
  toId: string;
  props: Record<string, unknown>;
  meta?: Record<string, unknown>;
};

const shapeToNode = new Map<string, string>();
const nodeToShape = new Map<string, string>();

const SHAPE_TO_NODE_TYPE: Record<string, string> = {
  "data-node": "data:json",
  "table-node": "data:table",
  "transform-node": "data:transform",
  "note-node": "view:note",
  "view-node": "view:svg-template",
  "web-view": "view:webview",
  "terminal-node": "sys:terminal",
  "notebook-node": "sys:notebook",
  "ai-node": "data:ai",
  "compact-node": "",
};

const NODE_TYPE_TO_SHAPE: Record<string, string> = {
  "data:json": "data-node",
  "data:table": "table-node",
  "data:transform": "transform-node",
  "data:ai": "ai-node",
  "view:note": "note-node",
  "view:svg-template": "view-node",
  "view:webview": "web-view",
  "sys:terminal": "terminal-node",
  "sys:notebook": "notebook-node",
};

const RUNTIME_MANAGED_PROPS: Record<string, string[]> = {
  "view-node": ["renderedContent"],
  "note-node": ["renderedContent"],
  "ai-node": ["response", "status", "errorMessage"],
  "terminal-node": ["history"],
  "notebook-node": [],
};

export function registerMapping(shapeId: string, nodeId: string): void {
  shapeToNode.set(shapeId, nodeId);
  nodeToShape.set(nodeId, shapeId);
}

export function unregisterMapping(shapeId: string): void {
  const nodeId = shapeToNode.get(shapeId);
  if (nodeId) nodeToShape.delete(nodeId);
  shapeToNode.delete(shapeId);
}

export function getNodeId(shapeId: string): string | undefined {
  return shapeToNode.get(shapeId);
}

export function getShapeId(nodeId: string): string | undefined {
  return nodeToShape.get(nodeId);
}

export function clearMappings(): void {
  shapeToNode.clear();
  nodeToShape.clear();
}

export function getNodeType(shapeType: string): string | undefined {
  return SHAPE_TO_NODE_TYPE[shapeType];
}

export function getShapeType(nodeType: string): string {
  return NODE_TYPE_TO_SHAPE[nodeType] || "compact-node";
}

export function getRuntimeConfig(
  shapeType: string,
  props: Record<string, unknown>,
): Record<string, unknown> {
  const runtimeManaged = new Set(RUNTIME_MANAGED_PROPS[shapeType] || []);
  const config: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(props)) {
    if (!runtimeManaged.has(key)) config[key] = value;
  }

  if (shapeType === "ai-node") {
    config.apiKey = typeof config.apiKey === "string" && config.apiKey
      ? config.apiKey
      : getApiKey();
    config.model = typeof config.model === "string" && config.model
      ? config.model
      : getModel();
  }

  return config;
}

export function hasRuntimeConfigChanges(
  shapeType: string,
  prevProps: Record<string, unknown>,
  nextProps: Record<string, unknown>,
): boolean {
  return stableStringify(normalizeConfigForDiff(shapeType, getRuntimeConfig(shapeType, prevProps)))
    !== stableStringify(normalizeConfigForDiff(shapeType, getRuntimeConfig(shapeType, nextProps)));
}

export function syncShapesToRuntime(editor: Editor, runtime: Runtime): void {
  for (const shape of editor.getCurrentPageShapes()) {
    ensureShapeNode(shape as unknown as ShapeRecord, runtime);
  }
}

export function ensureShapeNode(shape: ShapeRecord, runtime: Runtime): string | undefined {
  const nodeType = resolveNodeType(shape);
  if (!nodeType) return undefined;

  let nodeId = getNodeId(shape.id);
  if (!nodeId) {
    try {
      nodeId = runtime.graph.addNode(nodeType, getRuntimeConfig(shape.type, shape.props));
      registerMapping(shape.id, nodeId);
    } catch {
      return undefined;
    }
  }

  syncShapeNode(shape, runtime);
  return nodeId;
}

export function removeShapeNode(shapeId: string, runtime: Runtime): void {
  const nodeId = getNodeId(shapeId);
  if (nodeId) runtime.graph.removeNode(nodeId);
  unregisterMapping(shapeId);
}

export function syncShapeNode(shape: ShapeRecord, runtime: Runtime): void {
  const nodeId = ensureMapping(shape, runtime);
  if (!nodeId) return;

  runtime.graph.updateNode(nodeId, {
    config: getRuntimeConfig(shape.type, shape.props),
    meta: {
      position: { x: shape.x, y: shape.y },
      size: {
        w: typeof shape.props.w === "number" ? shape.props.w : 300,
        h: typeof shape.props.h === "number" ? shape.props.h : 200,
      },
    },
  });
}

export function syncNodeConfig(
  shapeId: string,
  props: Record<string, unknown>,
  runtime: Runtime,
  shapeType?: string,
): void {
  const nodeId = getNodeId(shapeId);
  if (!nodeId) return;
  const node = runtime.graph.getNode(nodeId);
  const effectiveShapeType = shapeType || getShapeType(node?.type || "");
  runtime.graph.updateNode(nodeId, {
    config: getRuntimeConfig(effectiveShapeType, props),
  });
}

export function rebuildEdges(editor: Editor, runtime: Runtime): void {
  for (const edge of runtime.graph.getEdges()) {
    runtime.graph.removeEdge(edge.id);
  }

  const arrows = editor.getCurrentPageShapes().filter((shape) => shape.type === "arrow");
  for (const arrow of arrows) {
    syncArrowToRuntime(editor, runtime, arrow.id);
  }
}

export function syncArrowToRuntime(editor: Editor, runtime: Runtime, arrowId: string): void {
  const bindings = editor.getBindingsFromShape(arrowId, "arrow") as BindingRecord[];
  const startBinding = bindings.find(binding => binding.props.terminal === "start");
  const endBinding = bindings.find(binding => binding.props.terminal === "end");
  if (!startBinding || !endBinding) return;

  const fromNodeId = getNodeId(startBinding.toId);
  const toNodeId = getNodeId(endBinding.toId);
  if (!fromNodeId || !toNodeId) return;

  const fromNode = runtime.graph.getNode(fromNodeId);
  const toNode = runtime.graph.getNode(toNodeId);
  if (!fromNode || !toNode) return;

  const fromDef = runtime.graph.getNodeDef(fromNode.type);
  const toDef = runtime.graph.getNodeDef(toNode.type);
  if (!fromDef || !toDef) return;

  const fromPort = resolvePortName(startBinding, fromDef.outputs.map(port => port.name), "output");
  const toPort = resolvePortName(endBinding, toDef.inputs.map(port => port.name), "input");
  if (!fromPort || !toPort) return;

  try {
    runtime.graph.addEdge(
      { node: fromNodeId, port: fromPort },
      { node: toNodeId, port: toPort },
    );
  } catch {
    // Invalid or duplicate edge; keep the runtime graph stable.
  }
}

export function syncRuntimeToShapes(editor: Editor, runtime: Runtime): void {
  for (const node of runtime.graph.getNodes()) {
    const shapeId = getShapeId(node.id);
    if (!shapeId) continue;

    const shape = editor.getShape(shapeId as never) as unknown as ShapeRecord | undefined;
    if (!shape) continue;

    const patch = buildShapePatch(shape, node.type, node.data, node.status, node.error);
    if (!patch) continue;

    editor.updateShape({
      id: shapeId as never,
      type: shape.type as never,
      props: patch,
    });
  }
}

function buildShapePatch(
  shape: ShapeRecord,
  nodeType: string,
  data: Record<string, unknown>,
  status: string,
  error?: string,
): Record<string, unknown> | null {
  if (nodeType === "view:svg-template") {
    const rendered = renderViewNode(shape.props, data);
    if (rendered && rendered !== shape.props.renderedContent) {
      return { renderedContent: rendered };
    }
    return null;
  }

  if (nodeType === "view:note") {
    const text = typeof data.text === "string" ? data.text : "";
    if (text && text !== shape.props.renderedContent) {
      return { renderedContent: text };
    }
    return null;
  }

  if (nodeType === "data:table") {
    // Sync upstream data into table when connected
    const rows = data.rows;
    if (Array.isArray(rows) && rows.length > 0) {
      try {
        const json = JSON.stringify(rows);
        if (json !== shape.props.dataJson) {
          return { dataJson: json };
        }
      } catch { /* */ }
    }
    return null;
  }

  if (nodeType === "data:ai") {
    const nextStatus = status === "running"
      ? "loading"
      : status === "error"
        ? "error"
        : status === "done"
          ? "done"
          : "idle";
    const response = typeof data.response === "string" ? data.response : "";
    const errorMessage = error || "";

    if (
      response !== shape.props.response ||
      nextStatus !== shape.props.status ||
      errorMessage !== shape.props.errorMessage
    ) {
      return {
        response,
        status: nextStatus,
        errorMessage,
      };
    }
  }

  if (nodeType === "sys:terminal") {
    const history = typeof data.history === "string" ? data.history : (shape.props.history as string);
    // Don't overwrite welcome message with empty runtime output
    if (history && history !== "[]" && history !== shape.props.history) {
      return { history };
    }
    return null;
  }

  if (nodeType === "sys:notebook") {
    // Only update cell outputs from runtime, never overwrite cell structure.
    // The notebook component manages cell add/delete/reorder directly.
    let nextCells = shape.props.cells;
    if (typeof data.cells === "string") {
      try {
        const runtimeCells = JSON.parse(data.cells) as Array<{ id: string; output?: string }>;
        const currentCells = JSON.parse(shape.props.cells) as Array<{ id: string; output?: string }>;
        const outputMap = new Map(runtimeCells.map(c => [c.id, c.output]));
        const merged = currentCells.map(c => {
          const runtimeOutput = outputMap.get(c.id);
          return runtimeOutput !== undefined ? { ...c, output: runtimeOutput } : c;
        });
        nextCells = JSON.stringify(merged);
      } catch {
        // If parsing fails, keep current cells
      }
    }

    if (nextCells !== shape.props.cells) {
      return { cells: nextCells };
    }
    return null;
  }

  return null;
}

function renderViewNode(
  props: Record<string, unknown>,
  data: Record<string, unknown>,
): string {
  const typeId = typeof props.typeId === "string" ? props.typeId : "";
  const renderData = data.renderData;
  if (!typeId || !renderData || typeof renderData !== "object" || Array.isArray(renderData)) {
    return typeof props.renderedContent === "string" ? props.renderedContent : "";
  }

  try {
    const template = getTemplateType(typeId) as { template_svg?: string } | null;
    if (!template?.template_svg) return typeof props.renderedContent === "string" ? props.renderedContent : "";
    return renderTemplateInline(template.template_svg, renderData as Record<string, unknown>);
  } catch {
    return typeof props.renderedContent === "string" ? props.renderedContent : "";
  }
}

function ensureMapping(shape: ShapeRecord, runtime: Runtime): string | undefined {
  let nodeId = getNodeId(shape.id);
  if (nodeId) return nodeId;

  const nodeType = resolveNodeType(shape);
  if (!nodeType) return undefined;

  try {
    nodeId = runtime.graph.addNode(nodeType, getRuntimeConfig(shape.type, shape.props));
    registerMapping(shape.id, nodeId);
    return nodeId;
  } catch {
    return undefined;
  }
}

function resolveNodeType(shape: Pick<ShapeRecord, "type" | "props">): string | undefined {
  const mapped = SHAPE_TO_NODE_TYPE[shape.type];
  if (mapped === undefined) return undefined;
  if (shape.type === "compact-node") {
    const nodeType = shape.props.nodeType;
    return typeof nodeType === "string" && nodeType ? nodeType : undefined;
  }
  return mapped || undefined;
}

function resolvePortName(
  binding: BindingRecord,
  knownPorts: string[],
  direction: "input" | "output",
): string | undefined {
  if (knownPorts.length === 0) return undefined;

  // Best case: explicit port name in binding metadata (stored in meta or props)
  const portName = binding.meta?.portName ?? binding.props.portName;
  if (typeof portName === "string" && knownPorts.includes(portName)) {
    return portName;
  }

  // Infer from binding terminal: "start" = output side, "end" = input side
  const terminal = binding.props.terminal;
  if (typeof terminal === "string") {
    const isCorrectSide =
      (direction === "output" && terminal === "start") ||
      (direction === "input" && terminal === "end");
    if (isCorrectSide && knownPorts.length === 1) {
      return knownPorts[0];
    }
  }

  // Infer from portSide metadata (in meta or props)
  const portSide = binding.meta?.portSide ?? binding.props.portSide;
  if (portSide === (direction === "output" ? "right" : "left")) {
    if (knownPorts.length === 1) return knownPorts[0];
  }

  // Single-port nodes: unambiguous, just use the only port
  if (knownPorts.length === 1) {
    return knownPorts[0];
  }

  // Universal defaults: "out" for output, "in" for input
  const universalDefault = direction === "output" ? "out" : "in";
  if (knownPorts.includes(universalDefault)) {
    return universalDefault;
  }

  // Multi-port node with no metadata: fallback with warning
  console.warn(
    `[svg-os] resolvePortName: cannot determine ${direction} port for binding (toId=${binding.toId}). ` +
    `Known ports: [${knownPorts.join(", ")}]. Falling back to "${knownPorts[0]}".`,
  );
  return knownPorts[0];
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(item => stableStringify(item)).join(",")}]`;
  }

  return `{${Object.keys(value as Record<string, unknown>)
    .sort()
    .map(key => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`)
    .join(",")}}`;
}

function normalizeConfigForDiff(
  shapeType: string,
  config: Record<string, unknown>,
): Record<string, unknown> {
  if (shapeType === "notebook-node") {
    const normalized = { ...config };
    if (typeof normalized.cells === "string") {
      try {
        const cells = JSON.parse(normalized.cells) as Array<Record<string, unknown>>;
        normalized.cells = JSON.stringify(cells.map((cell) => ({
          id: cell.id,
          type: cell.type,
          lang: cell.lang,
          source: cell.source,
        })));
      } catch {
        // Preserve raw config if parsing fails; the runtime will handle it.
      }
    }
    return normalized;
  }

  return config;
}
