/**
 * runtime-bridge — bidirectional mapping between tldraw shape IDs and
 * @svg-os/core Runtime node IDs.
 *
 * During the Phase 2 migration the canvas keeps both systems alive:
 *   - tldraw shapes own the visual state (position, size, props)
 *   - the Runtime graph mirrors the logical node topology
 *
 * This bridge:
 *   1. Maintains a shapeId <-> nodeId mapping
 *   2. Syncs existing tldraw shapes into the Runtime on startup
 *   3. Provides lookup helpers used by shape components and the palette
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
};

export function getNodeType(shapeType: string): string | undefined {
  return SHAPE_TO_NODE_TYPE[shapeType];
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
    const nodeType = SHAPE_TO_NODE_TYPE[shape.type];
    if (!nodeType) continue;

    // Skip if this shape is already mapped (e.g. hot-reload)
    if (shapeToNode.has(shape.id)) continue;

    try {
      const props = shape.props as Record<string, unknown>;
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
