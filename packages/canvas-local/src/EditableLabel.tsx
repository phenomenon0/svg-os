/**
 * EditableLabel — double-click to rename node labels inline.
 * Commits on Enter or blur. Used in all node title bars.
 */

import { useState, useRef, useCallback } from "react";
import { C, FONT } from "./theme";

export function EditableLabel({
  value,
  onChange,
  color = C.muted,
}: {
  value: string;
  onChange: (v: string) => void;
  color?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [local, setLocal] = useState(value);

  const commit = useCallback(() => {
    setEditing(false);
    if (local.trim() && local !== value) onChange(local.trim());
    else setLocal(value);
  }, [local, value, onChange]);

  const cleanupRef = useRef<(() => void) | null>(null);
  const inputRef = useCallback((el: HTMLInputElement | null) => {
    if (cleanupRef.current) { cleanupRef.current(); cleanupRef.current = null; }
    if (!el) return;
    el.focus();
    el.select();
    const handler = (e: PointerEvent) => { e.stopPropagation(); e.stopImmediatePropagation(); };
    el.addEventListener("pointerdown", handler, { capture: true });
    cleanupRef.current = () => el.removeEventListener("pointerdown", handler, { capture: true });
  }, []);

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") commit();
          if (e.key === "Escape") { setLocal(value); setEditing(false); }
        }}
        onBlur={commit}
        style={{
          background: C.bgDeep,
          border: `1px solid ${C.accent}`,
          borderRadius: 3,
          color: C.fg,
          fontSize: 11,
          fontFamily: FONT.sans,
          fontWeight: 500,
          padding: "0 4px",
          outline: "none",
          width: 80,
          letterSpacing: "0.02em",
        }}
      />
    );
  }

  return (
    <span
      onDoubleClick={(e) => { e.stopPropagation(); setLocal(value); setEditing(true); }}
      style={{
        color,
        fontSize: 11,
        fontWeight: 500,
        fontFamily: FONT.sans,
        letterSpacing: "0.02em",
        cursor: "default",
        userSelect: "none",
      }}
      title="Double-click to rename"
    >
      {value}
    </span>
  );
}
