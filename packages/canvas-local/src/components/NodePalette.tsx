/**
 * NodePalette — sidebar for desktop canvas.
 * Simplified version without WASM bridge or Runtime dependency.
 */

import { useEditor } from "tldraw";
import { useState, useCallback, useRef } from "react";
import { C, FONT } from "../theme";

const NODE_TO_SHAPE: Record<string, string> = {
  "sys:terminal": "terminal-node",
  "sys:notebook": "notebook-node",
  "data:json": "data-node",
  "data:table": "table-node",
  "data:transform": "transform-node",
  "data:ai": "ai-node",
  "view:note": "note-node",
  "view:webview": "web-view",
};

function defaultPropsForShape(shapeType: string): Record<string, unknown> {
  switch (shapeType) {
    case "terminal-node":
      return {
        w: 320, h: 220, label: "Terminal", mode: "js",
        history: JSON.stringify([{ type: "output", text: "SVG OS \u2014 raw terminal" }]),
      };
    case "notebook-node":
      return {
        w: 320, h: 240, label: "Notebook",
        cells: JSON.stringify([{ id: "c1", type: "code", lang: "python", source: "print('Hello!')\n2 ** 10", output: "" }]),
      };
    case "data-node":
      return { w: 220, h: 160, dataJson: '{"name": "Example", "score": 95}', label: "Data" };
    case "table-node":
      return { w: 280, h: 180, label: "Table", dataJson: "[]", selectedRow: -1, outputMode: "all" };
    case "transform-node":
      return { w: 160, h: 40, expression: "$.value", label: "Transform" };
    case "ai-node":
      return { w: 320, h: 240, label: "AI", prompt: "", response: "", model: "claude-opus-4-6", status: "idle", errorMessage: "" };
    case "note-node":
      return { w: 240, h: 180, label: "Note", content: "", mode: "edit" };
    case "web-view":
      return { w: 360, h: 280, url: "https://femiadeniran.com", label: "WebView", mode: "url", htmlContent: "" };
    default:
      return { w: 200, h: 150, label: "Node" };
  }
}

export function NodePalette() {
  const editor = useEditor();
  const [search, setSearch] = useState("");
  const placementCount = useRef(0);

  const offset = () => {
    const i = placementCount.current++;
    return { x: (i % 4) * 250 - 375, y: Math.floor(i / 4) * 200 - 100 };
  };

  const placeNode = useCallback((nodeType: string) => {
    const shapeType = NODE_TO_SHAPE[nodeType];
    if (!shapeType) return;
    const o = offset();
    const center = editor.getViewportScreenCenter();
    const props = defaultPropsForShape(shapeType);
    const w = (props.w as number) || 300;
    const h = (props.h as number) || 200;
    editor.createShape({
      type: shapeType,
      x: center.x - w / 2 + o.x,
      y: center.y - h / 2 + o.y,
      props,
    });
  }, [editor]);

  const q = search.toLowerCase().trim();

  const primitives = [
    { type: "view:note", label: "Note", color: C.accent },
    { type: "data:table", label: "Table", color: C.blue },
    { type: "sys:terminal", label: "Terminal", color: C.green },
    { type: "data:json", label: "Data", color: C.green },
    { type: "sys:notebook", label: "Notebook", color: C.purple },
    { type: "view:webview", label: "WebView", color: C.cyan },
    { type: "data:ai", label: "AI", color: C.blue },
    { type: "data:transform", label: "Transform", color: C.purple },
  ].filter(p => !q || p.label.toLowerCase().includes(q) || p.type.toLowerCase().includes(q));

  const renderDot = (color: string) => (
    <span style={{ width: 7, height: 7, borderRadius: "50%", background: color, flexShrink: 0 }} />
  );

  return (
    <div style={{
      position: "absolute",
      left: 0, top: 0, bottom: 0,
      width: 140,
      background: C.bg,
      borderRight: `1px solid ${C.border}`,
      overflowY: "auto",
      zIndex: 1000,
      pointerEvents: "all",
      fontFamily: FONT.sans,
      display: "flex",
      flexDirection: "column",
    }}>
      <div style={{ padding: "14px 16px", borderBottom: `1px solid ${C.border}` }}>
        <div style={{
          fontFamily: FONT.mono, fontSize: 10, fontWeight: 500,
          color: C.accent, textTransform: "uppercase", letterSpacing: "0.15em",
        }}>
          SVG OS
        </div>
      </div>

      <div style={{ padding: "8px 10px", borderBottom: `1px solid ${C.borderSoft}` }}>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter nodes..."
          style={{
            width: "100%", padding: "6px 8px",
            background: C.bgDeep, border: `1px solid ${C.border}`,
            borderRadius: 5, color: C.fg, fontSize: 11,
            fontFamily: FONT.sans, outline: "none",
          }}
        />
      </div>

      <div style={{ padding: "6px 4px", flex: 1, overflowY: "auto" }}>
        <div style={{
          fontFamily: FONT.mono, fontSize: 9, fontWeight: 500,
          color: C.faint, textTransform: "uppercase", letterSpacing: "0.1em",
          padding: "10px 10px 4px",
        }}>
          Primitives
        </div>
        {primitives.map(p => (
          <div
            key={p.type}
            onClick={() => placeNode(p.type)}
            style={{
              padding: "6px 10px", margin: "1px 0", borderRadius: 5,
              cursor: "pointer", fontSize: 12, fontFamily: FONT.sans,
              color: C.fgSoft, display: "flex", alignItems: "center", gap: 8,
              transition: "background 0.12s ease",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = C.bgHover; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
          >
            {renderDot(p.color)}
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 400 }}>
              {p.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
