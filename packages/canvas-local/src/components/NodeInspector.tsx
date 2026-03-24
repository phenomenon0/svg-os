/**
 * NodeInspector — right-side panel for desktop canvas.
 * Simplified version without Runtime dependency.
 */

import { useEditor, useValue } from "tldraw";
import { C, FONT } from "../theme";

const NODE_SHAPE_TYPES = [
  "data-node", "transform-node", "view-node", "table-node",
  "web-view", "terminal-node", "note-node", "notebook-node",
  "ai-node", "compact-node",
] as const;

const SHAPE_TO_NODE_TYPE_MAP: Record<string, string> = {
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

const TYPE_DESCRIPTIONS: Record<string, string> = {
  "data:json": "JSON data source",
  "data:table": "Tabular data editor",
  "data:transform": "Data transformer",
  "data:ai": "AI-powered processor",
  "view:note": "Rich text note",
  "view:svg-template": "SVG template renderer",
  "view:webview": "Embedded web view",
  "sys:terminal": "Terminal emulator",
  "sys:notebook": "Code notebook",
};

const SUBSYSTEM_COLORS: Record<string, string> = {
  system: C.green,
  data: C.blue,
  view: C.accent,
};

function inferSubsystem(nodeType: string): string {
  if (nodeType.startsWith("sys:")) return "system";
  if (nodeType.startsWith("data:")) return "data";
  if (nodeType.startsWith("view:")) return "view";
  return "system";
}

export function NodeInspector() {
  const editor = useEditor();

  const selected = useValue(
    "selected shape",
    () => {
      const ids = editor.getSelectedShapeIds();
      if (ids.length !== 1) return null;
      const shape = editor.getShape(ids[0]);
      if (!shape) return null;
      return shape;
    },
    [editor],
  );

  if (!selected || !NODE_SHAPE_TYPES.includes(selected.type as (typeof NODE_SHAPE_TYPES)[number])) return null;

  const props = selected.props as Record<string, unknown>;
  const nodeType =
    (props.nodeType as string) ||
    SHAPE_TO_NODE_TYPE_MAP[selected.type] ||
    selected.type;

  const subsystem = (props.subsystem as string) || inferSubsystem(nodeType);
  const color = SUBSYSTEM_COLORS[subsystem] || C.faint;
  const description = TYPE_DESCRIPTIONS[nodeType] || nodeType;

  return (
    <div
      style={{
        position: "absolute",
        right: 0, top: 0, bottom: 0,
        width: 280,
        background: C.bg,
        borderLeft: `1px solid ${C.border}`,
        overflowY: "auto",
        zIndex: 1000,
        pointerEvents: "all",
        fontFamily: FONT.sans,
        fontSize: 12,
        color: C.fg,
      }}
    >
      <div style={{
        padding: "12px 14px",
        borderBottom: `1px solid ${C.border}`,
        display: "flex",
        flexDirection: "column",
        gap: 4,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: color, flexShrink: 0 }} />
          <span style={{ fontSize: 11, fontWeight: 600, fontFamily: FONT.mono, color, letterSpacing: "0.03em" }}>
            {nodeType}
          </span>
        </div>
        <div style={{ fontSize: 10, color: C.muted, paddingLeft: 16 }}>
          {description}
        </div>
      </div>

      {/* Actions */}
      <div style={{ padding: "12px 14px", display: "flex", gap: 8 }}>
        <button
          onClick={() => editor.deleteShape(selected.id as any)}
          onPointerDown={(e) => e.stopPropagation()}
          style={{
            flex: 1,
            padding: "6px 12px",
            background: C.bgAlt,
            border: `1px solid ${C.red}44`,
            borderRadius: 6,
            color: C.red,
            fontSize: 11,
            fontWeight: 500,
            fontFamily: FONT.sans,
            cursor: "pointer",
          }}
        >
          Delete
        </button>
      </div>
    </div>
  );
}
