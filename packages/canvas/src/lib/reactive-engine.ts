/**
 * Reactive Engine — wires tldraw's store to the 3-primitive data flow model.
 *
 * Data flows: DataNode -> TransformNode -> ViewNode (via arrows).
 *
 * On any change to a DataNode or TransformNode, the engine:
 * 1. Rebuilds the adjacency graph from arrow bindings
 * 2. Topologically sorts the graph
 * 3. Evaluates each node in order:
 *    - DataNode: output = JSON.parse(dataJson)
 *    - TransformNode: output = evalExpression(expression, input)
 *    - ViewNode: renders template with input data, updates renderedContent
 * 4. Updates all affected shapes
 */

import type { Editor } from "tldraw";
import { getNodeType, listNodeTypes, renderTemplateInline } from "@svg-os/bridge";
import { evalJS, resultToData } from "./eval-sandbox";

// Node outputs are cached here between evaluations
const nodeOutputs = new Map<string, Record<string, unknown>>();

// Adjacency: targetId -> [sourceIds]
const dataFlowGraph = new Map<string, string[]>();

let pendingEval = false;
let isEvaluating = false;

export function wireReactiveEngine(editor: Editor) {
  // After shape props change -> schedule re-evaluation
  editor.sideEffects.registerAfterChangeHandler("shape", (prev, next, source) => {
    if (isEvaluating) return;
    const validTypes = ["data-node", "table-node", "transform-node", "terminal-node", "view-node", "note-node", "notebook-node", "ai-node", "web-view", "compact-node"];
    if (!validTypes.includes(next.type)) return;
    if (prev.props === next.props) return;
    scheduleEvaluation(editor);
  });

  // Listen for binding changes (arrows connecting shapes)
  editor.store.listen(
    (entry) => {
      let changed = false;
      for (const record of Object.values(entry.changes.added)) {
        if (record.typeName === "binding") changed = true;
      }
      for (const record of Object.values(entry.changes.removed)) {
        if (record.typeName === "binding") changed = true;
      }
      if (changed) {
        rebuildDataFlowGraph(editor);
        scheduleEvaluation(editor);
      }
    },
    { source: "all", scope: "document" },
  );

  // Initial graph build
  rebuildDataFlowGraph(editor);
}

function scheduleEvaluation(editor: Editor) {
  if (pendingEval) return;
  pendingEval = true;
  requestAnimationFrame(() => {
    pendingEval = false;
    evaluateGraph(editor);
  });
}

// ── Core graph evaluation ─────────────────────────────────────────────────────

function evaluateGraph(editor: Editor) {
  isEvaluating = true;
  try {
  const shapes = editor.getCurrentPageShapes();
  const nodeShapes = shapes.filter((s) =>
    ["data-node", "table-node", "transform-node", "terminal-node", "view-node", "note-node", "notebook-node", "ai-node", "web-view", "compact-node"].includes(s.type)
  );

  // Build full adjacency for topological sort
  const allIds = new Set(nodeShapes.map((s) => s.id as string));
  const inDegree = new Map<string, number>();
  const adjForward = new Map<string, string[]>(); // sourceId -> [targetIds]

  for (const id of allIds) {
    inDegree.set(id, 0);
    adjForward.set(id, []);
  }

  for (const [targetId, sources] of dataFlowGraph) {
    if (!allIds.has(targetId as string)) continue;
    for (const srcId of sources) {
      if (!allIds.has(srcId as string)) continue;
      adjForward.get(srcId as string)!.push(targetId);
      inDegree.set(targetId, (inDegree.get(targetId) || 0) + 1);
    }
  }

  // Kahn's algorithm for topological sort
  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  const sorted: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    sorted.push(id);
    for (const next of adjForward.get(id) || []) {
      const newDeg = (inDegree.get(next) || 1) - 1;
      inDegree.set(next, newDeg);
      if (newDeg === 0) queue.push(next);
    }
  }

  // Evaluate each node in topological order
  nodeOutputs.clear();

  for (const nodeId of sorted) {
    const shape = editor.getShape(nodeId as any);
    if (!shape) continue;

    // Gather input from upstream nodes
    const sources = dataFlowGraph.get(nodeId) || [];
    const input: Record<string, unknown> = {};
    for (const srcId of sources) {
      const srcOutput = nodeOutputs.get(srcId);
      if (srcOutput) {
        Object.assign(input, srcOutput);
      }
    }

    const shapeAny = shape as unknown as { id: string; type: string; props: Record<string, unknown> };
    if (shapeAny.type === "data-node") {
      evaluateDataNode(shapeAny, input);
    } else if (shapeAny.type === "table-node") {
      evaluateTableNode(editor, shapeAny, input);
    } else if (shapeAny.type === "transform-node") {
      evaluateTransformNode(shapeAny, input);
    } else if (shapeAny.type === "terminal-node") {
      evaluateTerminalNode(editor, shapeAny, input);
    } else if (shapeAny.type === "view-node") {
      evaluateViewNode(editor, shapeAny, input);
    } else if (shapeAny.type === "note-node") {
      evaluateNoteNode(editor, shapeAny, input);
    } else if (shapeAny.type === "notebook-node") {
      evaluateNotebookNode(shapeAny, input);
    } else if (shapeAny.type === "ai-node") {
      evaluateAINode(editor, shapeAny, input);
    } else if (shapeAny.type === "web-view") {
      evaluateWebView(editor, shapeAny, input);
    }
  }
  } finally {
    isEvaluating = false;
  }
}

// ── Per-type evaluation ───────────────────────────────────────────────────────

function evaluateDataNode(
  shape: { id: string; props: Record<string, unknown> },
  _input: Record<string, unknown>,
) {
  const dataJson = shape.props.dataJson as string;
  try {
    const parsed = JSON.parse(dataJson);
    nodeOutputs.set(shape.id, typeof parsed === "object" && parsed !== null ? parsed : { value: parsed });
  } catch {
    nodeOutputs.set(shape.id, {});
  }
}

function evaluateTableNode(
  editor: Editor,
  shape: { id: string; props: Record<string, unknown> },
  input: Record<string, unknown>,
) {
  // If upstream provides an array (via _rows or direct array), feed it into the table
  const upstreamRows = input._rows as unknown[] || (Array.isArray(input) ? input : null);
  if (upstreamRows && upstreamRows.length > 0) {
    const newJson = JSON.stringify(upstreamRows);
    const currentJson = shape.props.dataJson as string;
    if (newJson !== currentJson) {
      editor.updateShape({
        id: shape.id as any,
        type: "table-node",
        props: { dataJson: newJson },
      });
    }
  }

  const dataJson = upstreamRows ? JSON.stringify(upstreamRows) : (shape.props.dataJson as string);
  try {
    const rows = JSON.parse(dataJson);
    if (Array.isArray(rows)) {
      const selectedRow = shape.props.selectedRow as number;
      const outputMode = shape.props.outputMode as string;
      if (outputMode === "selected" && selectedRow >= 0 && selectedRow < rows.length) {
        nodeOutputs.set(shape.id, rows[selectedRow] as Record<string, unknown>);
      } else {
        const first = rows[0] || {};
        nodeOutputs.set(shape.id, { ...first, _rows: rows });
      }
    }
  } catch {
    nodeOutputs.set(shape.id, {});
  }
}

function evaluateTransformNode(
  shape: { id: string; props: Record<string, unknown> },
  input: Record<string, unknown>,
) {
  const expression = shape.props.expression as string;
  const { result, error } = evalJS(expression, input);
  if (error) {
    nodeOutputs.set(shape.id, input); // pass through on error
  } else {
    nodeOutputs.set(shape.id, resultToData(result));
  }
}

function evaluateTerminalNode(
  editor: Editor,
  shape: { id: string; props: Record<string, unknown> },
  input: Record<string, unknown>,
) {
  // Terminal outputs its last result to downstream nodes
  const historyJson = shape.props.history as string;
  try {
    const history = JSON.parse(historyJson) as Array<{ type: string; text: string }>;
    // Find last input command
    const lastInput = [...history].reverse().find(e => e.type === "input");
    if (lastInput) {
      const { result } = evalJS(lastInput.text, input);
      nodeOutputs.set(shape.id, resultToData(result));
      return;
    }
  } catch { /* */ }
  nodeOutputs.set(shape.id, input); // pass through if no commands
}

function evaluateViewNode(
  editor: Editor,
  shape: { id: string; props: Record<string, unknown> },
  input: Record<string, unknown>,
) {
  const viewType = shape.props.viewType as string;
  const typeId = shape.props.typeId as string;

  // Merge View's own data (from parameter panel) with upstream input
  let ownData: Record<string, unknown> = {};
  try {
    const d = shape.props.data as string;
    if (d) ownData = JSON.parse(d);
  } catch { /* */ }
  const mergedInput = { ...ownData, ...input };
  // Remove internal _rows key from render data
  delete mergedInput._rows;

  if (viewType === "svg-template" && typeId && Object.keys(mergedInput).length > 0) {
    // Render SVG template with input data
    try {
      const nt = getNodeType(typeId) as { template_svg?: string } | null;
      if (nt?.template_svg) {
        let rendered: string;
        try {
          rendered = renderTemplateInline(nt.template_svg, mergedInput);
        } catch {
          rendered = renderTemplateFallback(nt.template_svg, mergedInput);
        }

        const currentRendered = shape.props.renderedContent as string;
        if (rendered !== currentRendered) {
          editor.updateShape({
            id: shape.id as any,
            type: "view-node",
            props: { renderedContent: rendered },
          });
        }
      }
    } catch (e) {
      console.warn("[reactive] SVG view render failed:", e);
    }
  }

  // HTML views don't need re-rendering from data flow currently;
  // their content is set directly via props.
  // Future: map input data to htmlContent dynamically.

  // ViewNode doesn't produce output (it's a sink)
  nodeOutputs.set(shape.id, {});
}

function evaluateNoteNode(
  editor: Editor,
  shape: { id: string; props: Record<string, unknown> },
  input: Record<string, unknown>,
) {
  const rawContent = (shape.props.content as string) || "";
  let content = rawContent;

  if (Object.keys(input).length > 0) {
    // Interpolate {{field}} placeholders
    content = rawContent.replace(/\{\{(\w+)\}\}/g, (_m, field) => {
      return input[field] != null ? String(input[field]) : "";
    });

    // If note is empty, show upstream data as formatted JSON
    if (!rawContent.trim()) {
      content = Object.entries(input)
        .map(([k, v]) => `**${k}**: ${typeof v === "object" ? JSON.stringify(v) : v}`)
        .join("\n\n");
    }

    // WRITE BACK: update content + switch to preview to show result
    const currentContent = shape.props.content as string;
    if (content !== currentContent) {
      editor.updateShape({
        id: shape.id as any,
        type: "note-node",
        props: { content, mode: "preview" },
      });
    }
  }

  nodeOutputs.set(shape.id, { content });
}

function evaluateNotebookNode(
  shape: { id: string; props: Record<string, unknown> },
  input: Record<string, unknown>,
) {
  // Output all code cells' results
  try {
    const cells = JSON.parse((shape.props.cells as string) || "[]") as Array<{
      type: string;
      output?: string;
    }>;
    const codeCells = cells.filter(c => c.type === "code");
    const merged: Record<string, unknown> = {};

    for (let i = 0; i < codeCells.length; i++) {
      const cell = codeCells[i];
      if (!cell.output) continue;

      // Try parsing as JSON first
      try {
        const parsed = JSON.parse(cell.output);
        if (typeof parsed === "object" && parsed !== null) {
          Object.assign(merged, parsed);
        } else {
          merged[`cell${i}`] = parsed;
        }
      } catch {
        // Not JSON — treat as plain text output
        merged[`cell${i}`] = cell.output;
      }
    }

    // Also store the last cell's raw output as "value" for simple piping
    const lastCode = [...codeCells].reverse().find(c => c.output);
    if (lastCode?.output) {
      merged.value = lastCode.output;
    }

    if (Object.keys(merged).length > 0) {
      nodeOutputs.set(shape.id, merged);
      return;
    }
  } catch {
    /* */
  }
  nodeOutputs.set(shape.id, input);
}

// Track last AI call to prevent duplicate requests
const aiCallHashes = new Map<string, string>();

function evaluateAINode(
  editor: Editor,
  shape: { id: string; props: Record<string, unknown> },
  input: Record<string, unknown>,
) {
  const prompt = (shape.props.prompt as string) || "";
  const status = shape.props.status as string;

  // Interpolate prompt with upstream data
  let resolvedPrompt = prompt;
  if (Object.keys(input).length > 0) {
    resolvedPrompt = prompt.replace(/\{\{(\w+)\}\}/g, (_m, field) => {
      return input[field] != null ? String(input[field]) : "";
    });
  }

  // Hash to detect changes
  const hash = resolvedPrompt + JSON.stringify(input);
  const lastHash = aiCallHashes.get(shape.id);

  if (hash !== lastHash && status !== "loading" && resolvedPrompt.trim()) {
    aiCallHashes.set(shape.id, hash);
    // Fire async API call
    editor.updateShape({
      id: shape.id as any,
      type: "ai-node",
      props: { status: "loading", errorMessage: "" },
    });

    import("./claude-api").then(({ callClaude }) => {
      callClaude(resolvedPrompt, input).then(({ text, error }) => {
        editor.updateShape({
          id: shape.id as any,
          type: "ai-node",
          props: {
            response: text || "",
            status: error ? "error" : "done",
            errorMessage: error || "",
          },
        });
      });
    });
  }

  // Output current response
  const response = (shape.props.response as string) || "";
  nodeOutputs.set(shape.id, { response, prompt: resolvedPrompt });
}

// ── Fallback template renderer ────────────────────────────────────────────────

function renderTemplateFallback(
  templateSvg: string,
  data: Record<string, unknown>,
): string {
  let svg = templateSvg;

  // Replace mustache-style placeholders {{field}}
  svg = svg.replace(/\{\{(\w+)\}\}/g, (_match, field) => {
    return data[field] != null ? String(data[field]) : "";
  });

  // For slot-based attribute replacement
  let slots: Array<{ field: string; target_attr: string }> = [];
  try {
    const types = listNodeTypes();
    for (const t of types) {
      if (templateSvg.includes(t.id)) {
        slots = t.slots;
        break;
      }
    }
  } catch {
    /* ignore */
  }

  for (const slot of slots) {
    const val = data[slot.field];
    if (val == null) continue;
    const attrPattern = new RegExp(
      `(${escapeRegex(slot.target_attr)}\\s*=\\s*")[^"]*"`,
      "g",
    );
    svg = svg.replace(attrPattern, `$1${escapeHtml(String(val))}"`);
  }

  return svg;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ── Graph building ────────────────────────────────────────────────────────────

function evaluateWebView(
  editor: Editor,
  shape: { id: string; props: Record<string, unknown> },
  input: Record<string, unknown>,
) {
  // If upstream provides a URL (as "url" field or "value" field), update the iframe
  const upstreamUrl = (input.url as string) || (input.value as string) || "";
  if (upstreamUrl && upstreamUrl !== shape.props.url) {
    editor.updateShape({
      id: shape.id as any,
      type: "web-view",
      props: { url: upstreamUrl },
    });
  }
  nodeOutputs.set(shape.id, {});
}

function rebuildDataFlowGraph(editor: Editor) {
  dataFlowGraph.clear();

  const shapes = editor.getCurrentPageShapes();
  const arrows = shapes.filter((s) => s.type === "arrow");

  for (const arrow of arrows) {
    const bindings = editor.getBindingsFromShape(arrow.id, "arrow");
    if (bindings.length < 2) continue;

    const startBinding = bindings.find(
      (b) => (b.props as Record<string, unknown>).terminal === "start",
    );
    const endBinding = bindings.find(
      (b) => (b.props as Record<string, unknown>).terminal === "end",
    );

    if (startBinding && endBinding) {
      const sourceShapeId = startBinding.toId;
      const targetShapeId = endBinding.toId;

      if (!dataFlowGraph.has(targetShapeId)) {
        dataFlowGraph.set(targetShapeId, []);
      }
      dataFlowGraph.get(targetShapeId)!.push(sourceShapeId);
    }
  }
}
