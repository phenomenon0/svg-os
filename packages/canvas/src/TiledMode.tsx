/**
 * TiledMode — Repositions existing tldraw shapes into a tiled grid layout.
 *
 * Not a separate renderer — reuses tldraw by computing panel bounding boxes
 * from a TiledLayout tree, then moving/resizing shapes to fill their panels.
 */

import type { Editor } from "tldraw";
import type { TiledLayout, TiledPanelNode } from "./lib/workspace";

// ── Saved positions for restore ──────────────────────────────────────────────

interface SavedPosition {
  x: number;
  y: number;
  w: number;
  h: number;
}

const savedPositions = new Map<string, SavedPosition>();

// ── Bounding box ─────────────────────────────────────────────────────────────

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const GAP = 2; // thin cosmetic gap between panels

// ── Resolve layout tree into flat shape→rect mapping ─────────────────────────

export function resolveLayout(
  node: TiledPanelNode | TiledLayout,
  bounds: Rect,
): Map<string, Rect> {
  const result = new Map<string, Rect>();

  if ("children" in node && "direction" in node) {
    const { direction, children } = node;
    // Compute ratios
    const totalRatio = children.reduce((sum, c) => sum + (c.ratio ?? 1), 0);
    let offset = 0;

    for (const child of children) {
      const ratio = (child.ratio ?? 1) / totalRatio;
      let childBounds: Rect;

      if (direction === "horizontal") {
        const w = bounds.w * ratio - GAP;
        childBounds = { x: bounds.x + offset, y: bounds.y, w: Math.max(w, 100), h: bounds.h };
        offset += bounds.w * ratio;
      } else {
        const h = bounds.h * ratio - GAP;
        childBounds = { x: bounds.x, y: bounds.y + offset, w: bounds.w, h: Math.max(h, 100) };
        offset += bounds.h * ratio;
      }

      const childResults = resolveLayout(child, childBounds);
      for (const [id, rect] of childResults) {
        result.set(id, rect);
      }
    }
  }

  if ("type" in node && node.type === "leaf") {
    result.set(node.shapeId, bounds);
  }

  if ("type" in node && node.type === "split") {
    const { direction, children } = node;
    const totalRatio = children.reduce((sum, c) => sum + (c.ratio ?? 1), 0);
    let offset = 0;

    for (const child of children) {
      const ratio = (child.ratio ?? 1) / totalRatio;
      let childBounds: Rect;

      if (direction === "horizontal") {
        const w = bounds.w * ratio - GAP;
        childBounds = { x: bounds.x + offset, y: bounds.y, w: Math.max(w, 100), h: bounds.h };
        offset += bounds.w * ratio;
      } else {
        const h = bounds.h * ratio - GAP;
        childBounds = { x: bounds.x, y: bounds.y + offset, w: bounds.w, h: Math.max(h, 100) };
        offset += bounds.h * ratio;
      }

      const childResults = resolveLayout(child, childBounds);
      for (const [id, rect] of childResults) {
        result.set(id, rect);
      }
    }
  }

  return result;
}

// ── Apply tiled layout ───────────────────────────────────────────────────────

export function applyTiledLayout(
  editor: Editor,
  layout: TiledLayout,
  viewport?: { w: number; h: number },
): void {
  const vp = viewport ?? {
    w: window.innerWidth,
    h: window.innerHeight - 40, // account for workspace bar
  };

  const bounds: Rect = { x: 0, y: 0, w: vp.w, h: vp.h };
  const panelMap = resolveLayout(layout, bounds);

  // Save current positions before tiling
  for (const [shapeId] of panelMap) {
    const shape = editor.getShape(shapeId as never) as
      | { x: number; y: number; props: { w: number; h: number } }
      | undefined;
    if (shape && !savedPositions.has(shapeId)) {
      savedPositions.set(shapeId, {
        x: shape.x,
        y: shape.y,
        w: shape.props.w,
        h: shape.props.h,
      });
    }
  }

  // Reposition shapes
  for (const [shapeId, rect] of panelMap) {
    editor.updateShape({
      id: shapeId as never,
      type: editor.getShape(shapeId as never)?.type as never,
      x: rect.x,
      y: rect.y,
      props: { w: rect.w, h: rect.h } as never,
    });
  }

  // Zoom to fit the tiled layout
  requestAnimationFrame(() => {
    editor.zoomToFit({ animation: { duration: 200 } });
  });
}

// ── Restore canvas mode ──────────────────────────────────────────────────────

export function restoreCanvasMode(editor: Editor): void {
  // Restore saved positions
  for (const [shapeId, pos] of savedPositions) {
    const shape = editor.getShape(shapeId as never);
    if (shape) {
      editor.updateShape({
        id: shapeId as never,
        type: shape.type as never,
        x: pos.x,
        y: pos.y,
        props: { w: pos.w, h: pos.h } as never,
      });
    }
  }
  savedPositions.clear();

  // Zoom to fit restored positions
  requestAnimationFrame(() => {
    editor.zoomToFit({ animation: { duration: 200 } });
  });
}

// ── Resize handler ───────────────────────────────────────────────────────────

export function handleTiledResize(editor: Editor, layout: TiledLayout): void {
  applyTiledLayout(editor, layout);
}

// ── Clear saved positions (on workspace switch) ──────────────────────────────

export function clearSavedPositions(): void {
  savedPositions.clear();
}

// ── Tree mutation: split a leaf into two panels ──────────────────────────────

function splitNode(
  node: TiledPanelNode,
  targetShapeId: string,
  direction: "horizontal" | "vertical",
  newShapeId: string,
): TiledPanelNode {
  if (node.type === "leaf") {
    if (node.shapeId === targetShapeId) {
      return {
        type: "split",
        direction,
        children: [
          { type: "leaf", shapeId: node.shapeId },
          { type: "leaf", shapeId: newShapeId },
        ],
        ratio: node.ratio,
      };
    }
    return node;
  }

  // split node — recurse into children
  return {
    ...node,
    children: node.children.map((child) =>
      splitNode(child, targetShapeId, direction, newShapeId),
    ),
  };
}

export function splitLayoutLeaf(
  layout: TiledLayout,
  targetShapeId: string,
  direction: "horizontal" | "vertical",
  newShapeId: string,
): TiledLayout {
  return {
    ...layout,
    children: layout.children.map((child) =>
      splitNode(child, targetShapeId, direction, newShapeId),
    ),
  };
}

// ── Tree mutation: remove a leaf (collapse parent split) ─────────────────────

function removeNode(
  node: TiledPanelNode,
  targetShapeId: string,
): TiledPanelNode | null {
  if (node.type === "leaf") {
    return node.shapeId === targetShapeId ? null : node;
  }

  const remaining = node.children
    .map((child) => removeNode(child, targetShapeId))
    .filter((child): child is TiledPanelNode => child !== null);

  if (remaining.length === 0) return null;
  if (remaining.length === 1) return { ...remaining[0], ratio: node.ratio };
  return { ...node, children: remaining };
}

export function removeLayoutLeaf(
  layout: TiledLayout,
  targetShapeId: string,
): TiledLayout {
  const remaining = layout.children
    .map((child) => removeNode(child, targetShapeId))
    .filter((child): child is TiledPanelNode => child !== null);

  return { ...layout, children: remaining };
}
