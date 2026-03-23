/**
 * CommandPalette — VS Code / Obsidian-style command overlay.
 * Triggered by Cmd+K (macOS) or Ctrl+K (Linux/Windows).
 *
 * Reads available node types from the Runtime's node type registry.
 * Fuzzy-searches across node types and built-in actions.
 */

import { useEditor } from "tldraw";
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useRuntime } from "./RuntimeContext";
import { C, FONT } from "./theme";
import { listNodeTypes, getNodeType as bridgeGetNodeType, renderTemplateInline } from "@svg-os/bridge";
import { getModel } from "./lib/claude-api";

// ── Descriptions ──────────────────────────────────────────────────────────────

const NODE_DESCRIPTIONS: Record<string, string> = {
  "sys:file-open": "Open a file from disk",
  "sys:file-write": "Save content to a file",
  "sys:folder": "Browse a directory",
  "sys:disk": "Storage usage info",
  "sys:processes": "Runtime metrics & memory",
  "sys:clipboard-read": "Read from clipboard",
  "sys:clipboard-write": "Write to clipboard",
  "sys:screen-capture": "Take a screenshot",
  "sys:notify": "Send a notification",
  "sys:network": "Network connection info",
  "sys:geolocation": "GPS location",
  "sys:terminal": "Code execution sandbox",
  "sys:notebook": "Multi-cell notebook",
  "sys:env": "Environment variables",
  "data:json": "Static JSON source",
  "data:table": "Tabular data editor",
  "data:transform": "Expression transform",
  "data:filter": "Filter an array",
  "data:merge": "Merge two objects",
  "data:fetch": "HTTP fetch",
  "data:ai": "Claude AI completion",
  "view:svg-template": "Rendered SVG template",
  "view:note": "Markdown editor",
  "view:webview": "Web browser iframe",
  "view:metric": "Single value display",
  "view:chart": "Data chart",
};

// ── Shape mapping ─────────────────────────────────────────────────────────────

const NODE_TO_SHAPE: Record<string, string> = {
  "sys:terminal": "terminal-node",
  "sys:notebook": "notebook-node",
  "data:json": "data-node",
  "data:table": "table-node",
  "data:transform": "transform-node",
  "data:ai": "ai-node",
  "view:note": "note-node",
  "view:svg-template": "view-node",
  "view:webview": "web-view",
};

// ── Subsystem colors ──────────────────────────────────────────────────────────

function subsystemColor(type: string): string {
  if (type.startsWith("sys:")) return C.green;
  if (type.startsWith("data:")) return C.blue;
  if (type.startsWith("view:")) return C.accent;
  return C.muted;
}

// ── Default props per shape type ──────────────────────────────────────────────

function defaultPropsForShape(shapeType: string): Record<string, unknown> {
  switch (shapeType) {
    case "terminal-node":
      return {
        w: 400, h: 280, label: "Terminal", mode: "js",
        history: JSON.stringify([
          { type: "output", text: "SVG OS Terminal \u2014 JavaScript sandbox" },
          { type: "output", text: "Type expressions, see results. Try: 1 + 1" },
        ]),
      };
    case "notebook-node":
      return {
        w: 400, h: 320, label: "Notebook",
        cells: JSON.stringify([{ id: "c1", type: "code", lang: "python", source: "print('Hello!')\n2 ** 10", output: "" }]),
      };
    case "data-node":
      return { w: 300, h: 200, dataJson: '{\n  "name": "Example",\n  "score": 95\n}', label: "Data" };
    case "table-node":
      return { w: 320, h: 240, label: "Table", dataJson: "[]", selectedRow: -1, outputMode: "all" };
    case "transform-node":
      return { w: 180, h: 48, expression: "$.value", label: "Transform" };
    case "ai-node":
      return { w: 400, h: 320, label: "AI", prompt: "", response: "", model: getModel(), status: "idle", errorMessage: "" };
    case "note-node":
      return { w: 320, h: 240, label: "Note", content: "", mode: "edit" };
    case "web-view":
      return { w: 480, h: 360, url: "https://femiadeniran.com", label: "WebView", mode: "url", htmlContent: "" };
    default:
      return { w: 300, h: 200, label: "Node" };
  }
}

// ── Actions ───────────────────────────────────────────────────────────────────

interface PaletteAction {
  id: string;
  label: string;
  description: string;
  isAction: true;
  execute: () => void;
}

interface PaletteNode {
  id: string;
  label: string;
  description: string;
  isAction: false;
  nodeType: string;
}

type PaletteItem = PaletteAction | PaletteNode;

// ── Fuzzy match ───────────────────────────────────────────────────────────────

function fuzzyMatch(query: string, text: string): boolean {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (t.includes(q)) return true;
  // Simple character-by-character fuzzy
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  return qi === q.length;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function CommandPalette({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const editor = useEditor();
  const runtime = useRuntime();
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Focus input when opened
  useEffect(() => {
    if (open) {
      setQuery("");
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // ── Build items ───────────────────────────────────────────────────────

  const items: PaletteItem[] = useMemo(() => {
    const result: PaletteItem[] = [];

    // Node types from runtime
    if (runtime) {
      const defs = runtime.listNodeDefs();
      for (const def of defs) {
        // Skip svg templates — they appear via the bridge
        if (def.type === "view:svg-template") continue;
        const shapeType = NODE_TO_SHAPE[def.type];
        if (!shapeType) continue; // skip types without shape support
        result.push({
          id: def.type,
          label: def.type,
          description: NODE_DESCRIPTIONS[def.type] || "",
          isAction: false,
          nodeType: def.type,
        });
      }
    }

    // SVG templates from bridge
    try {
      const templates = listNodeTypes();
      for (const t of templates) {
        result.push({
          id: `tpl:${t.id}`,
          label: `view:${t.id}`,
          description: `SVG template: ${(t as any).name || t.id}`,
          isAction: false,
          nodeType: `tpl:${t.id}`,
        });
      }
    } catch { /* bridge not ready */ }

    // Actions
    result.push({
      id: "action:run-all",
      label: "Run All",
      description: "Execute entire graph",
      isAction: true,
      execute: () => {
        runtime?.run().catch(console.error);
      },
    });

    return result;
  }, [runtime]);

  // ── Filter ────────────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    if (!query.trim()) return items;
    return items.filter(
      (item) =>
        fuzzyMatch(query, item.label) ||
        fuzzyMatch(query, item.description),
    );
  }, [items, query]);

  // Clamp selected index
  useEffect(() => {
    if (selectedIndex >= filtered.length) {
      setSelectedIndex(Math.max(0, filtered.length - 1));
    }
  }, [filtered.length, selectedIndex]);

  // ── Place node ────────────────────────────────────────────────────────

  const placeNode = useCallback(
    (item: PaletteItem) => {
      if (item.isAction) {
        item.execute();
        onClose();
        return;
      }

      // SVG template
      if (item.nodeType.startsWith("tpl:")) {
        const typeId = item.nodeType.slice(4);
        try {
          const nt = bridgeGetNodeType(typeId) as {
            template_svg: string;
            default_width: number;
            default_height: number;
          };
          const maxSize = 280;
          const scale = Math.min(maxSize / nt.default_width, maxSize / nt.default_height, 1);
          const w = nt.default_width * scale;
          const h = nt.default_height * scale;
          const center = editor.getViewportScreenCenter();
          editor.createShape({
            type: "view-node",
            x: center.x - w / 2,
            y: center.y - h / 2,
            props: {
              w, h,
              viewType: "svg-template",
              typeId,
              renderedContent: nt.template_svg,
              variant: "", htmlTitle: "", htmlContent: "",
              data: "{}",
            },
          });
        } catch (e) {
          console.error(`Failed to place template ${typeId}:`, e);
        }
        onClose();
        return;
      }

      // Regular node
      const shapeType = NODE_TO_SHAPE[item.nodeType];
      if (!shapeType) {
        onClose();
        return;
      }

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

      // Track recently used
      try {
        const recent = JSON.parse(localStorage.getItem("svgos:recent-nodes") || "[]") as string[];
        const updated = [item.nodeType, ...recent.filter((r) => r !== item.nodeType)].slice(0, 5);
        localStorage.setItem("svgos:recent-nodes", JSON.stringify(updated));
      } catch { /* ignore */ }

      onClose();
    },
    [editor, onClose],
  );

  // ── Keyboard ──────────────────────────────────────────────────────────

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (filtered[selectedIndex]) {
          placeNode(filtered[selectedIndex]);
        }
      }
    },
    [filtered, selectedIndex, placeNode, onClose],
  );

  // Scroll selected item into view
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
        position: "absolute",
        inset: 0,
        zIndex: 2500,
        pointerEvents: "all",
        display: "flex",
        justifyContent: "center",
        paddingTop: 80,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          width: 500,
          maxHeight: 400,
          background: C.bgCard,
          border: `1px solid ${C.border}`,
          borderRadius: 10,
          boxShadow: "0 16px 48px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.04)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          fontFamily: FONT.sans,
        }}
      >
        {/* Search input */}
        <div
          style={{
            padding: "12px 16px",
            borderBottom: `1px solid ${C.border}`,
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <span style={{ color: C.faint, fontSize: 14, flexShrink: 0 }}>&#x2315;</span>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={onKeyDown}
            placeholder="Type to search nodes and actions..."
            style={{
              flex: 1,
              background: "transparent",
              border: "none",
              outline: "none",
              color: C.fg,
              fontSize: 14,
              fontFamily: FONT.sans,
              letterSpacing: "0.01em",
            }}
          />
        </div>

        {/* Results list */}
        <div
          ref={listRef}
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "4px 0",
          }}
        >
          {filtered.length === 0 && (
            <div
              style={{
                padding: "20px 16px",
                color: C.faint,
                fontSize: 13,
                textAlign: "center",
              }}
            >
              No results found
            </div>
          )}
          {filtered.map((item, i) => (
            <div
              key={item.id}
              onClick={() => placeNode(item)}
              onMouseEnter={() => setSelectedIndex(i)}
              style={{
                padding: "8px 16px",
                display: "flex",
                alignItems: "center",
                gap: 10,
                cursor: "pointer",
                background: i === selectedIndex ? C.bgHover : "transparent",
                transition: "background 0.08s ease",
              }}
            >
              {item.isAction ? (
                <span
                  style={{
                    width: 8,
                    height: 8,
                    flexShrink: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: C.accent,
                    fontSize: 11,
                    fontWeight: 700,
                  }}
                >
                  &#x25B6;
                </span>
              ) : (
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: item.nodeType.startsWith("tpl:")
                      ? C.cyan
                      : subsystemColor(item.nodeType),
                    flexShrink: 0,
                  }}
                />
              )}
              <span
                style={{
                  fontFamily: FONT.mono,
                  fontSize: 12,
                  color: C.fg,
                  fontWeight: 500,
                  minWidth: 140,
                  flexShrink: 0,
                }}
              >
                {item.isAction ? `> ${item.label}` : item.label}
              </span>
              <span
                style={{
                  fontSize: 12,
                  color: C.muted,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {item.description}
              </span>
            </div>
          ))}
        </div>

        {/* Footer hint */}
        <div
          style={{
            padding: "8px 16px",
            borderTop: `1px solid ${C.border}`,
            display: "flex",
            gap: 16,
            fontSize: 11,
            color: C.dim,
            fontFamily: FONT.mono,
          }}
        >
          <span>&#x2191;&#x2193; navigate</span>
          <span>&#x23CE; select</span>
          <span>esc close</span>
        </div>
      </div>
    </div>
  );
}
