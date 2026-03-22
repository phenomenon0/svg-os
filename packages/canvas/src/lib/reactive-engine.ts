/**
 * Reactive Engine -- wires tldraw's store to SVG OS's WASM engine.
 *
 * Responsibilities:
 * 1. On shape data change -> re-render the shape's SVG via WASM
 * 2. On arrow binding created -> register data flow connection
 * 3. On operation complete -> flush pending evaluations
 * 4. Debounce/batch pattern to avoid calling WASM on every keystroke
 */

import type { Editor } from "tldraw";
import { getNodeType, listNodeTypes } from "@svg-os/bridge";

let pendingEval = false;
const dataFlowGraph = new Map<string, string[]>(); // targetId -> [sourceIds]

export function wireReactiveEngine(editor: Editor) {
  // After shape props change -> schedule re-render
  editor.sideEffects.registerAfterChangeHandler("shape", (prev, next, source) => {
    if (source !== "user") return;
    if (next.type !== "svg-template" && next.type !== "html") return;
    if (prev.props === next.props) return; // no actual change
    scheduleReRender(editor, next.id);
  });

  // Listen for binding changes (arrows connecting shapes)
  editor.store.listen(
    (entry) => {
      let changed = false;
      for (const record of Object.values(entry.changes.added)) {
        if (record.typeName === "binding") {
          changed = true;
        }
      }
      for (const record of Object.values(entry.changes.removed)) {
        if (record.typeName === "binding") {
          changed = true;
        }
      }
      if (changed) rebuildDataFlowGraph(editor);
    },
    { source: "all", scope: "document" },
  );
}

function scheduleReRender(editor: Editor, shapeId: string) {
  if (pendingEval) return;
  pendingEval = true;
  requestAnimationFrame(() => {
    pendingEval = false;
    reRenderShape(editor, shapeId);
    propagateDataFlow(editor, shapeId);
  });
}

function reRenderShape(editor: Editor, shapeId: string) {
  const shape = editor.getShape(shapeId as any);
  if (!shape || shape.type !== "svg-template") return;

  const { typeId, data } = shape.props as Record<string, string>;
  if (!typeId) return;

  try {
    const nt = getNodeType(typeId) as {
      template_svg?: string;
      slots?: Array<{ field: string; target_attr: string }>;
    } | null;
    if (!nt?.template_svg) return;

    const parsedData: Record<string, unknown> = data ? JSON.parse(data) : {};

    // Merge upstream data if this shape has incoming connections
    const upstreamSources = dataFlowGraph.get(shapeId);
    if (upstreamSources) {
      const inputData: Record<string, unknown> = {};
      for (const srcId of upstreamSources) {
        const srcShape = editor.getShape(srcId as any);
        if (
          srcShape?.type === "svg-template" ||
          srcShape?.type === "html"
        ) {
          const srcData = (srcShape.props as Record<string, string>).data;
          if (srcData) {
            try {
              Object.assign(inputData, JSON.parse(srcData));
            } catch {
              /* malformed JSON -- skip */
            }
          }
        }
      }
      if (Object.keys(inputData).length > 0) {
        parsedData._input = inputData;
      }
    }

    // Render: substitute slot values into the template SVG
    const rendered = renderTemplate(nt.template_svg, nt.slots ?? [], parsedData);

    // Update shape without triggering user-source change (avoid recursion)
    editor.updateShape({
      id: shapeId as any,
      type: "svg-template",
      props: { svgContent: rendered },
    });
  } catch (e) {
    console.warn("[reactive] re-render failed:", e);
  }
}

/**
 * Simple template renderer: for each slot, replace placeholder text in the SVG
 * with the corresponding data value. Handles both {{field}} mustache syntax
 * and target_attr-based attribute replacement.
 */
function renderTemplate(
  templateSvg: string,
  slots: Array<{ field: string; target_attr: string }>,
  data: Record<string, unknown>,
): string {
  let svg = templateSvg;

  // Replace mustache-style placeholders {{field}}
  svg = svg.replace(/\{\{(\w+)\}\}/g, (_match, field) => {
    return data[field] != null ? String(data[field]) : "";
  });

  // For slot-based attribute replacement, update attribute values in-place
  for (const slot of slots) {
    const val = data[slot.field];
    if (val == null) continue;

    // Replace attribute values: attr="old" -> attr="new"
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
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function propagateDataFlow(editor: Editor, changedShapeId: string) {
  // Find shapes that depend on the changed shape
  for (const [targetId, sources] of dataFlowGraph) {
    if (sources.includes(changedShapeId)) {
      reRenderShape(editor, targetId);
    }
  }
}

function rebuildDataFlowGraph(editor: Editor) {
  dataFlowGraph.clear();

  // Get all arrow shapes on the current page
  const shapes = editor.getCurrentPageShapes();
  const arrows = shapes.filter((s) => s.type === "arrow");

  for (const arrow of arrows) {
    const bindings = editor.getBindingsFromShape(arrow.id, "arrow");
    if (bindings.length < 2) continue;

    // Arrow has start and end bindings
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
