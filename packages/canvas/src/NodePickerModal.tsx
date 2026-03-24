/**
 * NodePickerModal — lightweight modal for picking a node type.
 *
 * Used by the TiledPanelOverlay when splitting panels.
 * Shows a filtered list of placeable node types with keyboard navigation.
 */

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { C, FONT } from "./theme";
import {
  NODE_TO_SHAPE,
  NODE_DESCRIPTIONS,
  PLACEABLE_NODE_TYPES,
} from "./lib/node-registry";

export function NodePickerModal({
  onSelect,
  onClose,
}: {
  onSelect: (nodeType: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  const filtered = useMemo(() => {
    if (!query.trim()) return PLACEABLE_NODE_TYPES;
    const q = query.toLowerCase();
    return PLACEABLE_NODE_TYPES.filter(
      (item) =>
        item.label.toLowerCase().includes(q) ||
        item.nodeType.toLowerCase().includes(q) ||
        (NODE_DESCRIPTIONS[item.nodeType] || "").toLowerCase().includes(q),
    );
  }, [query]);

  useEffect(() => {
    if (selectedIndex >= filtered.length) {
      setSelectedIndex(Math.max(0, filtered.length - 1));
    }
  }, [filtered.length, selectedIndex]);

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
          onSelect(filtered[selectedIndex].nodeType);
        }
      }
    },
    [filtered, selectedIndex, onSelect, onClose],
  );

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 6000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0,0,0,0.5)",
        fontFamily: FONT.sans,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          width: 340,
          maxHeight: 360,
          background: C.bgCard,
          border: `1px solid ${C.border}`,
          borderRadius: 10,
          boxShadow: "0 16px 48px rgba(0,0,0,0.5)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "12px 16px",
            borderBottom: `1px solid ${C.border}`,
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <span style={{ color: C.faint, fontSize: 12, flexShrink: 0 }}>+</span>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={onKeyDown}
            placeholder="Pick a node type..."
            style={{
              flex: 1,
              background: "transparent",
              border: "none",
              outline: "none",
              color: C.fg,
              fontSize: 13,
              fontFamily: FONT.sans,
            }}
          />
        </div>

        {/* List */}
        <div style={{ flex: 1, overflowY: "auto", padding: "4px 0" }}>
          {filtered.length === 0 && (
            <div style={{ padding: "16px", color: C.faint, fontSize: 12, textAlign: "center" }}>
              No matching nodes
            </div>
          )}
          {filtered.map((item, i) => (
            <div
              key={item.nodeType}
              onClick={() => onSelect(item.nodeType)}
              onMouseEnter={() => setSelectedIndex(i)}
              style={{
                padding: "8px 16px",
                display: "flex",
                alignItems: "center",
                gap: 10,
                cursor: "pointer",
                background: i === selectedIndex ? C.bgHover : "transparent",
                transition: "background 0.08s",
              }}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: item.color,
                  flexShrink: 0,
                }}
              />
              <span style={{ color: C.fg, fontSize: 12, fontWeight: 500, minWidth: 80 }}>
                {item.label}
              </span>
              <span style={{ color: C.muted, fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {NODE_DESCRIPTIONS[item.nodeType] || ""}
              </span>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: "6px 16px",
            borderTop: `1px solid ${C.border}`,
            fontSize: 10,
            color: C.dim,
            fontFamily: FONT.mono,
            display: "flex",
            gap: 12,
          }}
        >
          <span>&#x2191;&#x2193; navigate</span>
          <span>&#x23CE; select</span>
          <span>esc cancel</span>
        </div>
      </div>
    </div>
  );
}
