/**
 * TiledPanelOverlay — Renders split buttons over each panel in tiled mode.
 *
 * Each panel gets split-H and split-V buttons (visible on hover) at its
 * top-right corner. Clicking opens a NodePickerModal, and the selected
 * node type is placed in the new split panel.
 */

import { useEditor } from "tldraw";
import { useState, useMemo, useCallback } from "react";
import { C, FONT } from "./theme";
import type { WorkspaceDescriptor } from "./lib/workspace";
import { resolveLayout, splitLayoutLeaf, applyTiledLayout } from "./TiledMode";
import { NODE_TO_SHAPE, defaultPropsForShape } from "./lib/node-registry";
import { NodePickerModal } from "./NodePickerModal";

let splitCounter = 0;
function nextSplitShapeId(): string {
  return `shape:split_${Date.now()}_${splitCounter++}` as string;
}

export function TiledPanelOverlay({
  descriptor,
  setDescriptor,
}: {
  descriptor: WorkspaceDescriptor;
  setDescriptor: (d: WorkspaceDescriptor) => void;
}) {
  const editor = useEditor();
  const [hoveredPanel, setHoveredPanel] = useState<string | null>(null);
  const [splitting, setSplitting] = useState<{
    shapeId: string;
    direction: "horizontal" | "vertical";
  } | null>(null);

  // Compute panel rects from the layout tree
  const panelRects = useMemo(() => {
    if (!descriptor.tiledLayout) return new Map<string, { x: number; y: number; w: number; h: number }>();
    const vp = { w: window.innerWidth, h: window.innerHeight - 40 };
    return resolveLayout(descriptor.tiledLayout, { x: 0, y: 0, w: vp.w, h: vp.h });
  }, [descriptor.tiledLayout]);

  // Handle split: create new shape + update layout tree + re-apply
  const handleSplit = useCallback(
    (nodeType: string) => {
      if (!splitting || !descriptor.tiledLayout) return;

      const shapeType = NODE_TO_SHAPE[nodeType];
      if (!shapeType) return;

      const newShapeId = nextSplitShapeId();
      const props = defaultPropsForShape(shapeType);

      // Create the new shape on canvas
      editor.createShape({
        id: newShapeId as never,
        type: shapeType as never,
        x: 0,
        y: 0,
        props: props as never,
      });

      // Mutate the layout tree
      const newLayout = splitLayoutLeaf(
        descriptor.tiledLayout,
        splitting.shapeId,
        splitting.direction,
        newShapeId,
      );

      // Update descriptor and re-apply layout
      const updated = {
        ...descriptor,
        tiledLayout: newLayout,
        updatedAt: Date.now(),
      };
      setDescriptor(updated);

      requestAnimationFrame(() => {
        applyTiledLayout(editor, newLayout);
      });

      setSplitting(null);
    },
    [splitting, descriptor, editor, setDescriptor],
  );

  if (!descriptor.tiledLayout || descriptor.mode !== "tiled") return null;

  return (
    <>
      {/* Panel overlays with split buttons */}
      {Array.from(panelRects.entries()).map(([shapeId, rect]) => (
        <div
          key={shapeId}
          onMouseEnter={() => setHoveredPanel(shapeId)}
          onMouseLeave={() => setHoveredPanel(null)}
          style={{
            position: "absolute",
            left: rect.x,
            top: rect.y,
            width: rect.w,
            height: rect.h,
            pointerEvents: "none",
            zIndex: 1500,
          }}
        >
          {/* Split buttons — visible on hover */}
          {hoveredPanel === shapeId && (
            <div
              style={{
                position: "absolute",
                top: 4,
                right: 4,
                display: "flex",
                gap: 2,
                pointerEvents: "all",
                zIndex: 1600,
              }}
            >
              <SplitButton
                label="&#x2502;"
                title="Split vertical"
                onClick={() => setSplitting({ shapeId, direction: "horizontal" })}
              />
              <SplitButton
                label="&#x2500;"
                title="Split horizontal"
                onClick={() => setSplitting({ shapeId, direction: "vertical" })}
              />
            </div>
          )}
        </div>
      ))}

      {/* Node picker modal when splitting */}
      {splitting && (
        <NodePickerModal
          onSelect={handleSplit}
          onClose={() => setSplitting(null)}
        />
      )}
    </>
  );
}

function SplitButton({
  label,
  title,
  onClick,
}: {
  label: string;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        width: 22,
        height: 22,
        background: C.bgCard + "dd",
        border: `1px solid ${C.border}`,
        borderRadius: 4,
        color: C.muted,
        fontSize: 12,
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: FONT.mono,
        lineHeight: 1,
        padding: 0,
        transition: "all 0.12s ease",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = C.accent;
        e.currentTarget.style.color = C.accent;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = C.border;
        e.currentTarget.style.color = C.muted;
      }}
    >
      <span dangerouslySetInnerHTML={{ __html: label }} />
    </button>
  );
}
