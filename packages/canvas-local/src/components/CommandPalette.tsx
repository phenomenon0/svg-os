/**
 * CommandPalette — VS Code / Obsidian-style command overlay.
 * Desktop version without Runtime or WASM bridge dependency.
 */

import { useEditor } from "tldraw";
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
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

const NODE_DESCRIPTIONS: Record<string, string> = {
  "sys:terminal": "Code execution sandbox",
  "sys:notebook": "Multi-cell notebook",
  "data:json": "Static JSON source",
  "data:table": "Tabular data editor",
  "data:transform": "Expression transform",
  "data:ai": "Claude AI completion",
  "view:note": "Markdown editor",
  "view:webview": "Web browser iframe",
};

function subsystemColor(type: string): string {
  if (type.startsWith("sys:")) return C.green;
  if (type.startsWith("data:")) return C.blue;
  if (type.startsWith("view:")) return C.accent;
  return C.muted;
}

function defaultPropsForShape(shapeType: string): Record<string, unknown> {
  switch (shapeType) {
    case "terminal-node":
      return { w: 400, h: 280, label: "Terminal", mode: "js", history: JSON.stringify([{ type: "output", text: "SVG OS Terminal" }]) };
    case "notebook-node":
      return { w: 400, h: 320, label: "Notebook", cells: JSON.stringify([{ id: "c1", type: "code", lang: "python", source: "print('Hello!')\n2 ** 10", output: "" }]) };
    case "data-node":
      return { w: 300, h: 200, dataJson: '{\n  "name": "Example",\n  "score": 95\n}', label: "Data" };
    case "table-node":
      return { w: 320, h: 240, label: "Table", dataJson: "[]", selectedRow: -1, outputMode: "all" };
    case "transform-node":
      return { w: 180, h: 48, expression: "$.value", label: "Transform" };
    case "ai-node":
      return { w: 400, h: 320, label: "AI", prompt: "", response: "", model: "claude-opus-4-6", status: "idle", errorMessage: "" };
    case "note-node":
      return { w: 320, h: 240, label: "Note", content: "", mode: "edit" };
    case "web-view":
      return { w: 480, h: 360, url: "https://femiadeniran.com", label: "WebView", mode: "url", htmlContent: "" };
    default:
      return { w: 300, h: 200, label: "Node" };
  }
}

function fuzzyMatch(query: string, text: string): boolean {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (t.includes(q)) return true;
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  return qi === q.length;
}

interface PaletteItem {
  id: string;
  label: string;
  description: string;
  nodeType: string;
}

export function CommandPalette({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const editor = useEditor();
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  const items: PaletteItem[] = useMemo(() => {
    return Object.entries(NODE_TO_SHAPE).map(([nodeType]) => ({
      id: nodeType,
      label: nodeType,
      description: NODE_DESCRIPTIONS[nodeType] || "",
      nodeType,
    }));
  }, []);

  const filtered = useMemo(() => {
    if (!query.trim()) return items;
    return items.filter(
      (item) => fuzzyMatch(query, item.label) || fuzzyMatch(query, item.description),
    );
  }, [items, query]);

  useEffect(() => {
    if (selectedIndex >= filtered.length) {
      setSelectedIndex(Math.max(0, filtered.length - 1));
    }
  }, [filtered.length, selectedIndex]);

  const placeNode = useCallback(
    (item: PaletteItem) => {
      const shapeType = NODE_TO_SHAPE[item.nodeType];
      if (!shapeType) { onClose(); return; }

      const center = editor.getViewportScreenCenter();
      const props = defaultPropsForShape(shapeType);
      const w = (props.w as number) || 300;
      const h = (props.h as number) || 200;

      editor.createShape({
        type: shapeType,
        x: center.x - w / 2,
        y: center.y - h / 2,
        props,
      });

      onClose();
    },
    [editor, onClose],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); }
      else if (e.key === "ArrowDown") { e.preventDefault(); setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1)); }
      else if (e.key === "ArrowUp") { e.preventDefault(); setSelectedIndex((i) => Math.max(i - 1, 0)); }
      else if (e.key === "Enter") { e.preventDefault(); if (filtered[selectedIndex]) placeNode(filtered[selectedIndex]); }
    },
    [filtered, selectedIndex, placeNode, onClose],
  );

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const item = list.children[selectedIndex] as HTMLElement | undefined;
    item?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  if (!open) return null;

  return (
    <div
      style={{
        position: "absolute", inset: 0, zIndex: 2500,
        pointerEvents: "all", display: "flex",
        justifyContent: "center", paddingTop: 80,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        width: 500, maxHeight: 400,
        background: C.bgCard, border: `1px solid ${C.border}`,
        borderRadius: 10, boxShadow: "0 16px 48px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.04)",
        display: "flex", flexDirection: "column", overflow: "hidden", fontFamily: FONT.sans,
      }}>
        <div style={{
          padding: "12px 16px", borderBottom: `1px solid ${C.border}`,
          display: "flex", alignItems: "center", gap: 10,
        }}>
          <span style={{ color: C.faint, fontSize: 14, flexShrink: 0 }}>&#x2315;</span>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setSelectedIndex(0); }}
            onKeyDown={onKeyDown}
            placeholder="Type to search nodes..."
            style={{
              flex: 1, background: "transparent", border: "none", outline: "none",
              color: C.fg, fontSize: 14, fontFamily: FONT.sans,
            }}
          />
        </div>

        <div ref={listRef} style={{ flex: 1, overflowY: "auto", padding: "4px 0" }}>
          {filtered.length === 0 && (
            <div style={{ padding: "20px 16px", color: C.faint, fontSize: 13, textAlign: "center" }}>
              No results found
            </div>
          )}
          {filtered.map((item, i) => (
            <div
              key={item.id}
              onClick={() => placeNode(item)}
              onMouseEnter={() => setSelectedIndex(i)}
              style={{
                padding: "8px 16px", display: "flex", alignItems: "center", gap: 10,
                cursor: "pointer",
                background: i === selectedIndex ? C.bgHover : "transparent",
                transition: "background 0.08s ease",
              }}
            >
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: subsystemColor(item.nodeType), flexShrink: 0 }} />
              <span style={{ fontFamily: FONT.mono, fontSize: 12, color: C.fg, fontWeight: 500, minWidth: 140, flexShrink: 0 }}>
                {item.label}
              </span>
              <span style={{ fontSize: 12, color: C.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {item.description}
              </span>
            </div>
          ))}
        </div>

        <div style={{
          padding: "8px 16px", borderTop: `1px solid ${C.border}`,
          display: "flex", gap: 16, fontSize: 11, color: C.dim, fontFamily: FONT.mono,
        }}>
          <span>&#x2191;&#x2193; navigate</span>
          <span>&#x23CE; select</span>
          <span>esc close</span>
        </div>
      </div>
    </div>
  );
}
