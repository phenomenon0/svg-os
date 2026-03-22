/**
 * Node Palette — sidebar listing SVG OS node types.
 * Click to place a template shape on the canvas.
 */

import { useEditor } from "tldraw";
import { listNodeTypes, getNodeType } from "@svg-os/bridge";
import { useState, useEffect, useCallback } from "react";

interface NodeTypeInfo {
  id: string;
  name: string;
  category: string;
  slots: Array<{ field: string; bind_type: string; target_attr: string }>;
  default_width: number;
  default_height: number;
}

export function NodePalette() {
  const editor = useEditor();
  const [types, setTypes] = useState<NodeTypeInfo[]>([]);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  useEffect(() => {
    // Poll for types until they're loaded (WASM async init)
    const interval = setInterval(() => {
      try {
        const t = listNodeTypes();
        if (t.length > 0) {
          setTypes(t);
          clearInterval(interval);
        }
      } catch { /* WASM not ready yet */ }
    }, 500);
    return () => clearInterval(interval);
  }, []);

  const handlePlace = useCallback((typeId: string) => {
    try {
      const nt = getNodeType(typeId) as { template_svg: string; default_width: number; default_height: number };
      const maxSize = 200;
      const scale = Math.min(maxSize / nt.default_width, maxSize / nt.default_height, 1);
      const w = nt.default_width * scale;
      const h = nt.default_height * scale;
      const center = editor.getViewportScreenCenter();

      editor.createShape({
        type: "svg-template",
        x: center.x - w / 2,
        y: center.y - h / 2,
        props: {
          w,
          h,
          typeId,
          svgContent: nt.template_svg,
        },
      });
    } catch (e) {
      console.error(`Failed to place ${typeId}:`, e);
    }
  }, [editor]);

  // Group by category
  const categories = new Map<string, NodeTypeInfo[]>();
  for (const t of types) {
    if (!categories.has(t.category)) categories.set(t.category, []);
    categories.get(t.category)!.push(t);
  }

  const toggleCategory = (cat: string) => {
    setCollapsed((prev) => ({ ...prev, [cat]: !prev[cat] }));
  };

  return (
    <div style={{
      position: "absolute",
      left: 0,
      top: 0,
      bottom: 0,
      width: 200,
      background: "#151d2e",
      borderRight: "1px solid #334155",
      overflowY: "auto",
      zIndex: 1000,
      fontFamily: "Inter, system-ui, sans-serif",
    }}>
      <div style={{
        padding: "10px 12px",
        fontSize: 11,
        fontWeight: 600,
        color: "#94a3b8",
        textTransform: "uppercase",
        letterSpacing: "0.05em",
        borderBottom: "1px solid #334155",
      }}>
        Node Types
      </div>

      {types.length === 0 && (
        <div style={{ padding: 12, color: "#475569", fontSize: 12, textAlign: "center" }}>
          Loading templates...
        </div>
      )}

      {Array.from(categories.entries()).map(([category, items]) => (
        <div key={category} style={{ borderBottom: "1px solid #1e293b" }}>
          <div
            onClick={() => toggleCategory(category)}
            style={{
              padding: "6px 12px",
              fontSize: 10,
              fontWeight: 600,
              color: "#64748b",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              cursor: "pointer",
              userSelect: "none",
            }}
          >
            {collapsed[category] ? "▶" : "▼"} {category}
          </div>

          {!collapsed[category] && (
            <div style={{ padding: "0 4px 4px" }}>
              {items.map((item) => (
                <div
                  key={item.id}
                  onClick={() => handlePlace(item.id)}
                  style={{
                    padding: "6px 8px",
                    margin: "1px 0",
                    borderRadius: 4,
                    cursor: "pointer",
                    fontSize: 12,
                    color: "#cbd5e1",
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "#1e293b")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  <span style={{
                    width: 16, height: 16, borderRadius: 3,
                    background: "#334155",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 9, flexShrink: 0,
                  }}>
                    {item.name.charAt(0).toUpperCase()}
                  </span>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {item.name}
                  </span>
                  <span style={{ marginLeft: "auto", fontSize: 10, color: "#475569", flexShrink: 0 }}>
                    {item.slots.length}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
