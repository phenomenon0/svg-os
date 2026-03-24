/**
 * TableNode — structured data spreadsheet on the canvas.
 * Click cells to edit. Paste CSV. Click row # to select.
 * dataSource tracks ownership: "local" = user edits, "upstream" = connected data.
 */

import {
  HTMLContainer, Rectangle2d, ShapeUtil, T, TLBaseShape, Vec, useEditor,
} from "tldraw";
import { useRef, useCallback, useState } from "react";
import { Port } from "../Port";
import { EditableLabel } from "../EditableLabel";
import { C, FONT } from "../theme";

export type TableNodeShape = TLBaseShape<
  "table-node",
  { w: number; h: number; label: string; dataJson: string; selectedRow: number; dataSource: string; outputMode: string }
>;

export class TableNodeShapeUtil extends ShapeUtil<TableNodeShape> {
  static override type = "table-node" as const;
  static override props = {
    w: T.number, h: T.number, label: T.string, dataJson: T.string,
    selectedRow: T.number, dataSource: T.string, outputMode: T.string,
  };

  getDefaultProps(): TableNodeShape["props"] {
    return { w: 360, h: 240, label: "Table", dataJson: "[]", selectedRow: -1, dataSource: "local", outputMode: "all" };
  }

  override getGeometry(shape: TableNodeShape) {
    return new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: true });
  }

  override canBind() { return true; }
  override canEdit() { return false; }

  override getHandleSnapGeometry(shape: TableNodeShape) {
    return { points: [new Vec(0, shape.props.h / 2), new Vec(shape.props.w, shape.props.h / 2)] };
  }

  override component(shape: TableNodeShape) { return <TableComponent shape={shape} />; }

  override indicator(shape: TableNodeShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={8} />;
  }

  override canResize() { return true; }

  override onResize(shape: TableNodeShape, info: { scaleX: number; scaleY: number }) {
    return { props: { w: Math.max(200, shape.props.w * info.scaleX), h: Math.max(120, shape.props.h * info.scaleY) } };
  }
}

// ── CSV parsing ─────────────────────────────────────────────────────────────

function parseCSV(text: string): Record<string, string>[] {
  const lines = text.trim().split("\n").map(l => l.trim()).filter(Boolean);
  if (lines.length < 1) return [];

  // Detect delimiter: tab or comma
  const delim = lines[0].includes("\t") ? "\t" : ",";
  const headers = lines[0].split(delim).map(h => h.trim().replace(/^["']|["']$/g, ""));
  if (headers.length === 0) return [];

  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const vals = lines[i].split(delim).map(v => v.trim().replace(/^["']|["']$/g, ""));
    const row: Record<string, string> = {};
    headers.forEach((h, j) => row[h] = vals[j] || "");
    rows.push(row);
  }
  return rows;
}

function isCSVLike(text: string): boolean {
  const lines = text.trim().split("\n");
  if (lines.length < 2) return false;
  const delim = lines[0].includes("\t") ? "\t" : ",";
  const headerCols = lines[0].split(delim).length;
  return headerCols >= 2 && lines[1].split(delim).length >= 2;
}

// ── Component ────────────────────────────────────────────────────────────────

function TableComponent({ shape }: { shape: TableNodeShape }) {
  const editor = useEditor();
  const { w, h, label, dataJson, selectedRow, dataSource } = shape.props;

  let rows: Record<string, string>[] = [];
  try { rows = JSON.parse(dataJson); } catch { /* */ }

  // Collect ALL columns across all rows (not just first row)
  const colSet = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) colSet.add(key);
  }
  const columns = [...colSet];

  const update = useCallback((newRows: Record<string, string>[]) => {
    editor.updateShape({ id: shape.id, type: "table-node", props: { dataJson: JSON.stringify(newRows), dataSource: "local" } });
  }, [editor, shape.id]);

  const addColumn = useCallback(() => {
    const names = ["name", "value", "type", "status", "score", "color", "label", "url"];
    const existing = new Set(columns);
    const name = names.find(n => !existing.has(n)) || `col${columns.length + 1}`;
    if (rows.length === 0) {
      update([{ [name]: "" }]);
    } else {
      update(rows.map(r => ({ ...r, [name]: "" })));
    }
  }, [rows, columns, update]);

  const addRow = useCallback(() => {
    const empty: Record<string, string> = {};
    columns.forEach(c => empty[c] = "");
    update([...rows, empty]);
  }, [rows, columns, update]);

  const deleteColumn = useCallback((col: string) => {
    update(rows.map(r => { const n = { ...r }; delete n[col]; return n; }));
  }, [rows, update]);

  const deleteRow = useCallback((idx: number) => {
    update(rows.filter((_, i) => i !== idx));
  }, [rows, update]);

  const setCell = useCallback((rowIdx: number, col: string, val: string) => {
    const updated = [...rows];
    updated[rowIdx] = { ...updated[rowIdx], [col]: val };
    update(updated);
  }, [rows, update]);

  const renameColumn = useCallback((oldName: string, newName: string) => {
    if (!newName.trim() || newName === oldName) return;
    if (columns.includes(newName)) return;
    update(rows.map(r => {
      const n: Record<string, string> = {};
      for (const [k, v] of Object.entries(r)) {
        n[k === oldName ? newName : k] = v;
      }
      return n;
    }));
  }, [rows, columns, update]);

  const selectRow = useCallback((idx: number) => {
    const next = idx === selectedRow ? -1 : idx; // toggle
    editor.updateShape({ id: shape.id, type: "table-node", props: { selectedRow: next } });
  }, [editor, shape.id, selectedRow]);

  // CSV paste handler
  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const text = e.clipboardData.getData("text/plain");
    if (!text || !isCSVLike(text)) return;
    e.preventDefault();
    e.stopPropagation();
    const parsed = parseCSV(text);
    if (parsed.length > 0) {
      update(parsed);
    }
  }, [update]);

  const cellW = columns.length > 0 ? Math.max(60, (w - 30) / columns.length) : 100;
  const isUpstream = dataSource === "upstream";

  return (
    <HTMLContainer style={{ width: w, height: h, pointerEvents: "all" }}>
      <div
        onPaste={handlePaste}
        style={{
          width: "100%", height: "100%",
          background: C.bg, border: `1px solid ${C.border}`,
          borderRadius: 8, overflow: "hidden",
          display: "flex", flexDirection: "column",
          fontFamily: FONT.sans, position: "relative",
          boxShadow: "0 2px 12px rgba(0,0,0,0.35)",
        }}
      >
        {/* Title bar */}
        <div style={{
          height: 28, padding: "0 10px",
          background: C.bgAlt, borderBottom: `1px solid ${C.border}`,
          display: "flex", alignItems: "center", gap: 6, flexShrink: 0,
        }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: C.blue }} />
          <EditableLabel value={label} onChange={v => editor.updateShape({ id: shape.id, type: "table-node", props: { label: v } })} />
          <span style={{ flex: 1 }} />
          {isUpstream && (
            <span style={{ fontSize: 8, color: C.accent, fontFamily: FONT.mono, opacity: 0.6 }}>LINKED</span>
          )}
          <span style={{ fontSize: 9, color: C.faint, fontFamily: FONT.mono }}>
            {rows.length}×{columns.length}
          </span>
        </div>

        {/* Grid */}
        <div style={{ flex: 1, overflow: "auto" }}>
          {columns.length === 0 ? (
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              height: "100%", flexDirection: "column", gap: 8,
            }}>
              <span style={{ color: C.dim, fontSize: 11 }}>Empty table</span>
              <span style={{ color: C.faint, fontSize: 9 }}>Paste CSV or click below</span>
              <button onClick={e => { e.stopPropagation(); addColumn(); }}
                onPointerDown={e => e.stopPropagation()}
                style={btnStyle}>+ Column</button>
            </div>
          ) : (
            <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 11 }}>
              <thead>
                <tr>
                  <th style={{ ...thStyle, width: 24, color: C.dim }}>#</th>
                  {columns.map(col => (
                    <th key={col} style={{ ...thStyle, width: cellW, position: "relative" }}>
                      <CellInput
                        value={col}
                        onChange={v => renameColumn(col, v)}
                        style={{ fontWeight: 500, color: C.accent }}
                      />
                      <span
                        onClick={e => { e.stopPropagation(); deleteColumn(col); }}
                        onPointerDown={e => e.stopPropagation()}
                        style={{
                          position: "absolute", right: 2, top: 2,
                          cursor: "pointer", color: C.dim, fontSize: 8,
                          opacity: 0.5, lineHeight: 1,
                        }}
                      >{"\u00d7"}</span>
                    </th>
                  ))}
                  <th style={{ ...thStyle, width: 24 }}>
                    <span onClick={e => { e.stopPropagation(); addColumn(); }}
                      onPointerDown={e => e.stopPropagation()}
                      style={{ cursor: "pointer", color: C.blue, fontSize: 12 }}>+</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, ri) => (
                  <tr key={ri} style={{
                    background: ri === selectedRow ? `${C.accent}15` : undefined,
                  }}>
                    <td
                      style={{ ...tdStyle, color: ri === selectedRow ? C.accent : C.dim, textAlign: "center", fontSize: 9, cursor: "pointer", fontWeight: ri === selectedRow ? 600 : 400 }}
                      onClick={e => { e.stopPropagation(); selectRow(ri); }}
                      onPointerDown={e => e.stopPropagation()}
                    >{ri}</td>
                    {columns.map(col => (
                      <td key={col} style={tdStyle}>
                        <CellInput value={String(row[col] ?? "")} onChange={v => setCell(ri, col, v)} />
                      </td>
                    ))}
                    <td style={{ ...tdStyle, textAlign: "center" }}>
                      <span onClick={e => { e.stopPropagation(); deleteRow(ri); }}
                        onPointerDown={e => e.stopPropagation()}
                        style={{ cursor: "pointer", color: C.dim, fontSize: 9, opacity: 0.5 }}>{"\u00d7"}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer — add row */}
        {columns.length > 0 && (
          <div style={{
            height: 24, borderTop: `1px solid ${C.borderSoft}`,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <span onClick={e => { e.stopPropagation(); addRow(); }}
              onPointerDown={e => e.stopPropagation()}
              style={{ cursor: "pointer", color: C.blue, fontSize: 11, fontFamily: FONT.mono }}>
              + row
            </span>
          </div>
        )}

        <Port side="left" type="any" name="in" shapeId={shape.id} />
        <Port side="right" type="any" name="out" shapeId={shape.id} />
      </div>
    </HTMLContainer>
  );
}

// ── Cell Input ───────────────────────────────────────────────────────────────

function CellInput({ value, onChange, style: extraStyle }: { value: string; onChange: (v: string) => void; style?: React.CSSProperties }) {
  const [local, setLocal] = useState(value);
  const [focused, setFocused] = useState(false);
  const cleanupRef = useRef<(() => void) | null>(null);

  if (value !== local && !focused) setLocal(value);

  const inputRef = useCallback((el: HTMLInputElement | null) => {
    if (cleanupRef.current) { cleanupRef.current(); cleanupRef.current = null; }
    if (!el) return;
    const handler = (e: PointerEvent) => { e.stopPropagation(); e.stopImmediatePropagation(); };
    el.addEventListener("pointerdown", handler, { capture: true });
    cleanupRef.current = () => el.removeEventListener("pointerdown", handler, { capture: true });
  }, []);

  return (
    <input ref={inputRef} type="text" value={local}
      onChange={e => setLocal(e.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={() => { setFocused(false); if (local !== value) onChange(local); }}
      onKeyDown={e => { e.stopPropagation(); if (e.key === "Enter") { (e.target as HTMLInputElement).blur(); } }}
      style={{
        width: "100%", padding: "2px 4px",
        background: "transparent", border: "none",
        color: C.fg, fontSize: 11, fontFamily: FONT.mono,
        outline: "none",
        ...extraStyle,
      }}
    />
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────

const thStyle: React.CSSProperties = {
  padding: "4px 6px",
  textAlign: "left",
  borderBottom: `1px solid ${C.border}`,
  background: C.bgAlt,
  fontSize: 10,
  fontFamily: FONT.mono,
  fontWeight: 500,
  letterSpacing: "0.03em",
};

const tdStyle: React.CSSProperties = {
  padding: "1px 2px",
  borderBottom: `1px solid ${C.borderSoft}`,
  verticalAlign: "middle",
};

const btnStyle: React.CSSProperties = {
  background: `${C.blue}22`,
  border: `1px solid ${C.blue}44`,
  borderRadius: 4,
  color: C.blue,
  fontSize: 10,
  padding: "4px 12px",
  cursor: "pointer",
  fontFamily: FONT.mono,
};
