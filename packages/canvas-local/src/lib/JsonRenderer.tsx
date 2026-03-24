/**
 * JsonRenderer — collapsible tree view for JSON data.
 * Reusable across nodes. Renders objects, arrays, primitives
 * with syntax-colored values and expand/collapse.
 */

import { useState, useRef, useCallback } from "react";
import { C, FONT } from "../theme";

interface JsonRendererProps {
  data: unknown;
  maxDepth?: number;
  rootOpen?: boolean;
}

export function JsonRenderer({ data, maxDepth = 8, rootOpen = true }: JsonRendererProps) {
  return (
    <div style={{
      fontFamily: FONT.mono,
      fontSize: 12,
      lineHeight: 1.6,
      color: C.fg,
      overflow: "auto",
      padding: "4px 0",
      userSelect: "text",
    }}>
      <JsonValue value={data} depth={0} maxDepth={maxDepth} defaultOpen={rootOpen} />
    </div>
  );
}

function JsonValue({
  value,
  depth,
  maxDepth,
  defaultOpen,
  keyName,
}: {
  value: unknown;
  depth: number;
  maxDepth: number;
  defaultOpen?: boolean;
  keyName?: string;
}) {
  if (value === null) return <Leaf keyName={keyName} value="null" color={C.faint} />;
  if (value === undefined) return <Leaf keyName={keyName} value="undefined" color={C.faint} />;

  if (typeof value === "boolean") {
    return <Leaf keyName={keyName} value={String(value)} color={C.orange} />;
  }
  if (typeof value === "number") {
    return <Leaf keyName={keyName} value={String(value)} color={C.blue} />;
  }
  if (typeof value === "string") {
    // Truncate long strings
    const display = value.length > 80 ? value.slice(0, 77) + "\u2026" : value;
    return <Leaf keyName={keyName} value={`"${display}"`} color={C.green} />;
  }

  if (Array.isArray(value)) {
    return (
      <CollapsibleNode
        keyName={keyName}
        bracket={["[", "]"]}
        count={value.length}
        depth={depth}
        maxDepth={maxDepth}
        defaultOpen={defaultOpen ?? depth < 2}
      >
        {value.map((item, i) => (
          <JsonValue
            key={i}
            value={item}
            depth={depth + 1}
            maxDepth={maxDepth}
            keyName={String(i)}
          />
        ))}
      </CollapsibleNode>
    );
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    return (
      <CollapsibleNode
        keyName={keyName}
        bracket={["{", "}"]}
        count={entries.length}
        depth={depth}
        maxDepth={maxDepth}
        defaultOpen={defaultOpen ?? depth < 2}
      >
        {entries.map(([k, v]) => (
          <JsonValue
            key={k}
            value={v}
            depth={depth + 1}
            maxDepth={maxDepth}
            keyName={k}
          />
        ))}
      </CollapsibleNode>
    );
  }

  return <Leaf keyName={keyName} value={String(value)} color={C.muted} />;
}

// ── Leaf (primitive value) ───────────────────────────────────────────────────

function Leaf({
  keyName,
  value,
  color,
}: {
  keyName?: string;
  value: string;
  color: string;
}) {
  return (
    <div style={{ paddingLeft: 4, display: "flex", gap: 0 }}>
      {keyName !== undefined && (
        <span style={{ color: C.accent, marginRight: 0 }}>
          {keyName}<span style={{ color: C.faint }}>: </span>
        </span>
      )}
      <span style={{ color }}>{value}</span>
    </div>
  );
}

// ── Collapsible node (object/array) ──────────────────────────────────────────

function CollapsibleNode({
  keyName,
  bracket,
  count,
  depth,
  maxDepth,
  defaultOpen,
  children,
}: {
  keyName?: string;
  bracket: [string, string];
  count: number;
  depth: number;
  maxDepth: number;
  defaultOpen: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen && depth < maxDepth);

  // Capture-phase pointer interception
  const cleanupRef = useRef<(() => void) | null>(null);
  const toggleRef = useCallback((el: HTMLSpanElement | null) => {
    if (cleanupRef.current) { cleanupRef.current(); cleanupRef.current = null; }
    if (!el) return;
    const handler = (e: PointerEvent) => {
      e.stopPropagation();
      e.stopImmediatePropagation();
    };
    el.addEventListener("pointerdown", handler, { capture: true });
    cleanupRef.current = () => el.removeEventListener("pointerdown", handler, { capture: true });
  }, []);

  if (depth >= maxDepth) {
    return (
      <div style={{ paddingLeft: 4 }}>
        {keyName !== undefined && (
          <span style={{ color: C.accent }}>{keyName}<span style={{ color: C.faint }}>: </span></span>
        )}
        <span style={{ color: C.faint }}>{bracket[0]}\u2026{bracket[1]}</span>
        <span style={{ color: C.dim, fontSize: 10, marginLeft: 4 }}>{count}</span>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-start", paddingLeft: 4 }}>
        <span
          ref={toggleRef}
          onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
          style={{
            cursor: "pointer",
            color: C.faint,
            width: 14,
            flexShrink: 0,
            textAlign: "center",
            fontSize: 10,
            lineHeight: "19px",
            userSelect: "none",
          }}
        >
          {open ? "\u25BC" : "\u25B6"}
        </span>
        {keyName !== undefined && (
          <span style={{ color: C.accent }}>{keyName}<span style={{ color: C.faint }}>: </span></span>
        )}
        <span style={{ color: C.faint }}>
          {bracket[0]}
          {!open && (
            <>
              <span style={{ color: C.dim, fontSize: 10, padding: "0 4px" }}>
                {count} {count === 1 ? "item" : "items"}
              </span>
              {bracket[1]}
            </>
          )}
        </span>
      </div>
      {open && (
        <>
          <div style={{ paddingLeft: 18, borderLeft: `1px solid ${C.borderSoft}`, marginLeft: 10 }}>
            {children}
          </div>
          <div style={{ paddingLeft: 4, color: C.faint }}>{bracket[1]}</div>
        </>
      )}
    </div>
  );
}
