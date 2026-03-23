/**
 * runtime-bridge — bidirectional mapping between tldraw shape IDs and
 * @svg-os/core Runtime node IDs.
 *
 * Phase 3: The Runtime Scheduler is the single execution engine.
 * This bridge:
 *   1. Maintains a shapeId <-> nodeId mapping
 *   2. Syncs existing tldraw shapes into the Runtime on startup
 *   3. Syncs tldraw arrow bindings as Runtime edges
 *   4. Pushes config changes into Runtime nodes
 *   5. Reads Runtime outputs back into tldraw shapes
 */

import type { Runtime } from "@svg-os/core";
import type { Editor } from "tldraw";

// ── Bidirectional mapping ──────────────────────────────────────────────────

const shapeToNode = new Map<string, string>();
const nodeToShape = new Map<string, string>();

export function registerMapping(shapeId: string, nodeId: string): void {
  shapeToNode.set(shapeId, nodeId);
  nodeToShape.set(nodeId, shapeId);
}

export function unregisterMapping(shapeId: string): void {
  const nodeId = shapeToNode.get(shapeId);
  if (nodeId) {
    nodeToShape.delete(nodeId);
  }
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

// ── Shape type -> Runtime node type ────────────────────────────────────────

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
  "compact-node": "", // determined by nodeType prop
};

export function getNodeType(shapeType: string): string | undefined {
  return SHAPE_TO_NODE_TYPE[shapeType];
}

// ── Reverse: Runtime node type -> tldraw shape type ───────────────────────

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
  // Everything else -> compact-node
};

export function getShapeType(nodeType: string): string {
  return NODE_TYPE_TO_SHAPE[nodeType] || "compact-node";
}

// ── Initial sync: tldraw shapes -> Runtime graph ───────────────────────────

/**
 * Walk every shape on the current tldraw page and create a matching node in
 * the Runtime graph.  Position and size are stored in node meta so the
 * Runtime has a complete picture even though tldraw still owns rendering.
 *
 * Shapes whose type does not map to a registered node definition are silently
 * skipped (e.g. arrows, groups, or unknown shapes).
 */
export function syncShapesToRuntime(editor: Editor, runtime: Runtime): void {
  const shapes = editor.getCurrentPageShapes();

  for (const shape of shapes) {
    let nodeType = SHAPE_TO_NODE_TYPE[shape.type];
    if (nodeType === undefined) continue;

    // For compact-node, the actual node type is stored in the shape props
    const props = shape.props as Record<string, unknown>;
    if (shape.type === "compact-node") {
      nodeType = (props.nodeType as string) || "";
      if (!nodeType) continue;
    }
    if (!nodeType) continue;

    // Skip if this shape is already mapped (e.g. hot-reload)
    if (shapeToNode.has(shape.id)) continue;

    try {
      const nodeId = runtime.graph.addNode(nodeType, { ...props });

      registerMapping(shape.id, nodeId);

      // Persist position & size so the Runtime graph knows layout
      runtime.graph.updateNode(nodeId, {
        meta: {
          position: { x: shape.x, y: shape.y },
          size: {
            w: (props.w as number) ?? 300,
            h: (props.h as number) ?? 200,
          },
        },
      });
    } catch {
      // Node type not registered in the runtime — skip silently
    }
  }
}

// ── Phase 3: Edge sync — tldraw arrows -> Runtime edges ─────────────────

/**
 * Walk every arrow on the current page and mirror its bindings as Runtime
 * graph edges.  Call this after clearing existing edges when bindings change.
 */
export function syncEdgesToRuntime(editor: Editor, runtime: Runtime): void {
  const shapes = editor.getCurrentPageShapes();
  const arrows = shapes.filter((s) => s.type === "arrow");

  for (const arrow of arrows) {
    const bindings = editor.getBindingsFromShape(arrow.id, "arrow");
    const startBinding = bindings.find(
      (b) => (b.props as Record<string, unknown>).terminal === "start",
    );
    const endBinding = bindings.find(
      (b) => (b.props as Record<string, unknown>).terminal === "end",
    );

    if (startBinding && endBinding) {
      const fromNodeId = getNodeId(startBinding.toId);
      const toNodeId = getNodeId(endBinding.toId);
      if (fromNodeId && toNodeId) {
        const fromNode = runtime.graph.getNode(fromNodeId);
        const toNode = runtime.graph.getNode(toNodeId);
        if (fromNode && toNode) {
          const fromDef = runtime.graph.getNodeDef(fromNode.type);
          const toDef = runtime.graph.getNodeDef(toNode.type);
          const fromPort = fromDef?.outputs[0]?.name || "data";
          const toPort = toDef?.inputs[0]?.name || "data";

          try {
            runtime.graph.addEdge(
              { node: fromNodeId, port: fromPort },
              { node: toNodeId, port: toPort },
            );
          } catch {
            // Edge already exists or validation failed — skip silently
          }
        }
      }
    }
  }
}

// ── Phase 3: Config sync — tldraw shape props -> Runtime node config ────

/**
 * Push a shape's changed props into the matching Runtime node's config.
 */
export function syncNodeConfig(
  shapeId: string,
  props: Record<string, unknown>,
  runtime: Runtime,
): void {
  const nodeId = getNodeId(shapeId);
  if (!nodeId) return;
  runtime.graph.updateNode(nodeId, { config: props });
}

// ── Phase 3: Output sync — Runtime node data -> tldraw shapes ───────────

/**
 * After the Scheduler executes, read each node's output data and push
 * relevant fields back into the corresponding tldraw shape props.
 *
 * Currently handles:
 *   - view:svg-template  → renderedContent
 *   - view:note          → (reserved for downstream text)
 *
 * As node definitions grow richer this function will expand.
 */
export function syncRuntimeToShapes(editor: Editor, runtime: Runtime): void {
  for (const node of runtime.graph.getNodes()) {
    const shapeId = getShapeId(node.id);
    if (!shapeId) continue;

    const shape = editor.getShape(shapeId as any);
    if (!shape) continue;

    // View nodes: the Runtime may have produced rendered SVG content
    if (node.type === "view:svg-template" && node.data.data != null) {
      const currentRendered = (shape.props as Record<string, unknown>)
        .renderedContent as string | undefined;
      const rendered = node.data.data as string;
      if (rendered && rendered !== currentRendered) {
        editor.updateShape({
          id: shapeId as any,
          type: "view-node",
          props: { renderedContent: rendered },
        });
      }
    }

    // Future: sync other node type outputs back to tldraw shapes
  }
}
