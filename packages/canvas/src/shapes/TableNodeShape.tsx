/**
 * TableNode — an editable spreadsheet that IS the data editor.
 *
 * Click any cell to edit it inline. Tab to next cell. Enter to confirm.
 * Add rows with the + button. Add columns by connecting to a View (its
 * template slots appear as columns automatically).
 *
 * This is the primary data primitive — no JSON editing, just a spreadsheet.
 */

import {
  HTMLContainer,
  Rectangle2d,
  ShapeUtil,
  T,
  TLBaseShape,
  Vec,
  useEditor,
} from "tldraw";
import { useState, useRef, useCallback, useEffect } from "react";
import { Port } from "../Port";

export type TableNodeShape = TLBaseShape<
  "table-node",
  {
    w: number;
    h: number;
    label: string;
    dataJson: string;
    selectedRow: number;
    filterExpr: string;
    outputMode: string;
  }
>;

export class TableNodeShapeUtil extends ShapeUtil<TableNodeShape> {
  static override type = "table-node" as const;

  static override props = {
    w: T.number,
    h: T.number,
    label: T.string,
    dataJson: T.string,
    selectedRow: T.number,
    filterExpr: T.string,
    outputMode: T.string,
  };

  getDefaultProps(): TableNodeShape["props"] {
    return {
      w: 360,
      h: 280,
      label: "Data",
      dataJson: JSON.stringify([
        { name: "Pedri", position: "CM", score: 92 },
        { name: "Salah", position: "RW", score: 89 },
        { name: "Haaland", position: "ST", score: 91 },
        { name: "Rodri", position: "DM", score: 90 },
        { name: "Bellingham", position: "AM", score: 88 },
      ]),
      selectedRow: -1,
      filterExpr: "",
      outputMode: "all",
    };
  }

  override getGeometry(shape: TableNodeShape) {
    return new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: true });
  }

  override canBind() { return true; }

  override getHandleSnapGeometry(shape: TableNodeShape) {
    return {
      points: [
        new Vec(0, shape.props.h / 2),
        new Vec(shape.props.w, shape.props.h / 2),
      ],
    };
  }

  override component(shape: TableNodeShape) {
    return <EditableTable shape={shape} />;
  }

  override indicator(shape: TableNodeShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={8} />;
  }

  override canResize() { return true; }

  override onResize(shape: TableNodeShape, info: { scaleX: number; scaleY: number }) {
    return {
      props: {
        w: Math.max(240, shape.props.w * info.scaleX),
        h: Math.max(140, shape.props.h * info.scaleY),
      },
    };
  }
}

// ── Editable Table Component ─────────────────────────────────────────────────

function EditableTable({ shape }: { shape: TableNodeShape }) {
  const editor = useEditor();
  const { w, h, label, dataJson } = shape.props;
  const [editingHeader, setEditingHeader] = useState<string | null>(null);

  let rows: Record<string, unknown>[] = [];
  try { rows = JSON.parse(dataJson); } catch { /* */ }
  const columns = rows.length > 0 ? Object.keys(rows[0]) : [];

  const updateData = useCallback((newRows: Record<string, unknown>[]) => {
    editor.updateShape({
      id: shape.id,
      type: "table-node",
      props: { dataJson: JSON.stringify(newRows) },
    });
  }, [editor, shape.id]);

  const setCellValue = useCallback((rowIdx: number, col: string, value: string) => {
    const newRows = [...rows];
    newRows[rowIdx] = { ...newRows[rowIdx], [col]: isNaN(Number(value)) ? value : Number(value) };
    updateData(newRows);
  }, [rows, updateData]);

  const renameColumn = useCallback((oldName: string, newName: string) => {
    if (!newName || newName === oldName) { setEditingHeader(null); return; }
    const newRows = rows.map(row => {
      const newRow: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(row)) {
        newRow[k === oldName ? newName : k] = v;
      }
      return newRow;
    });
    updateData(newRows);
    setEditingHeader(null);
  }, [rows, updateData]);

  const addRow = useCallback(() => {
    const empty: Record<string, unknown> = {};
    columns.forEach(c => empty[c] = "");
    updateData([...rows, empty]);
  }, [rows, columns, updateData]);

  const addColumn = useCallback(() => {
    const name = `col${columns.length + 1}`;
    const newRows = rows.map(row => ({ ...row, [name]: "" }));
    updateData(newRows);
  }, [rows, columns, updateData]);

  const deleteRow = useCallback((idx: number) => {
    const newRows = rows.filter((_, i) => i !== idx);
    updateData(newRows);
  }, [rows, updateData]);

  return (
    <HTMLContainer style={{ width: w, height: h, pointerEvents: "all" }}>
      <div style={{
        width: "100%", height: "100%",
        background: "#0f172a", border: "1px solid #334155",
        borderRadius: 8, overflow: "hidden",
        display: "flex", flexDirection: "column",
        fontFamily: "'Inter', system-ui, sans-serif",
        position: "relative",
      }}>
        {/* Header */}
        <div style={{
          height: 30, padding: "0 8px",
          background: "#1e293b",
          borderBottom: "1px solid #334155",
          display: "flex", alignItems: "center", gap: 6,
          fontSize: 11, fontWeight: 600, color: "#94a3b8",
          flexShrink: 0,
        }}>
          <span style={{ width: 6, height: 6, borderRadius: 2, background: "#3b82f6" }} />
          <span style={{ flex: 1 }}>{label}</span>
          <span style={{ fontSize: 9, color: "#475569" }}>{rows.length} rows · {columns.length} cols</span>
        </div>

        {/* Spreadsheet */}
        <div style={{ flex: 1, overflow: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
            <thead>
              <tr>
                <th style={{ ...thStyle, width: 24, textAlign: "center" }}>#</th>
                {columns.map(col => (
                  <th
                    key={col}
                    style={thStyle}
                    onClick={(e) => { e.stopPropagation(); setEditingHeader(col); }}
                  >
                    {editingHeader === col ? (
                      <input
                        defaultValue={col}
                        autoFocus
                        onBlur={(e) => renameColumn(col, e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") renameColumn(col, (e.target as HTMLInputElement).value);
                          if (e.key === "Escape") setEditingHeader(null);
                          e.stopPropagation();
                        }}
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => e.stopPropagation()}
                        style={{
                          width: "100%", padding: "2px 4px",
                          background: "#1e3a5f", border: "1px solid #3b82f6",
                          borderRadius: 2, color: "#e2e8f0",
                          fontSize: 10, fontFamily: "inherit", outline: "none",
                        }}
                      />
                    ) : col}
                  </th>
                ))}
                <th style={{ ...thStyle, width: 24 }}>
                  <button
                    onClick={(e) => { e.stopPropagation(); addColumn(); }}
                    style={addBtnStyle}
                    title="Add column"
                  >+</button>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, ri) => (
                <tr key={ri} style={{ background: ri % 2 === 0 ? "transparent" : "#0c1220" }}>
                  <td style={{ ...tdStyle, color: "#475569", textAlign: "center", width: 24, fontSize: 9 }}>{ri}</td>
                  {columns.map(col => (
                    <td key={col} style={{ ...tdStyle, padding: 0, minWidth: 50 }}>
                      <CellInput
                        value={String(row[col] ?? "")}
                        onChange={(val) => setCellValue(ri, col, val)}
                      />
                    </td>
                  ))}
                  <td style={{ ...tdStyle, width: 24, textAlign: "center" }}>
                    <button
                      onClick={(e) => { e.stopPropagation(); deleteRow(ri); }}
                      style={{ ...addBtnStyle, color: "#475569", fontSize: 9 }}
                      title="Delete row"
                    >×</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Footer with add row */}
        <div style={{
          height: 28, padding: "0 8px",
          borderTop: "1px solid #1e293b",
          display: "flex", alignItems: "center", gap: 6,
          fontSize: 10, color: "#475569", flexShrink: 0,
        }}>
          <button
            onClick={(e) => { e.stopPropagation(); addRow(); }}
            style={{ ...addBtnStyle, padding: "2px 8px", fontSize: 10 }}
          >+ Row</button>
          <span style={{ marginLeft: "auto", fontSize: 9 }}>
            Click cell to edit
          </span>
        </div>

        <Port side="left" color="#06b6d4" shapeId={shape.id} />
        <Port side="right" color="#3b82f6" shapeId={shape.id} />
      </div>
    </HTMLContainer>
  );
}

const thStyle: React.CSSProperties = {
  padding: "4px 6px", textAlign: "left",
  borderBottom: "1px solid #1e293b",
  color: "#64748b", fontWeight: 600, fontSize: 10,
  position: "sticky", top: 0,
  background: "#0f172a",
  textTransform: "uppercase", letterSpacing: "0.03em",
  userSelect: "none",
};

const tdStyle: React.CSSProperties = {
  padding: "3px 6px",
  borderBottom: "1px solid #0c1220",
  color: "#cbd5e1",
};

const addBtnStyle: React.CSSProperties = {
  background: "none", border: "1px solid #334155",
  borderRadius: 3, color: "#64748b",
  cursor: "pointer", fontSize: 11, padding: "0 4px",
  lineHeight: "16px",
};

/** Always-visible input cell. Looks like text until focused. */
function CellInput({ value, onChange }: { value: string; onChange: (val: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <input
      ref={ref}
      defaultValue={value}
      key={value} // reset when external data changes
      onBlur={(e) => {
        if (e.target.value !== value) onChange(e.target.value);
        e.target.style.background = "transparent";
      }}
      onFocus={(e) => {
        e.target.style.background = "#1e3a5f";
        e.target.select();
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      style={{
        width: "100%", padding: "3px 6px",
        background: "transparent", border: "none",
        borderBottom: "1px solid transparent",
        color: value ? "#cbd5e1" : "#334155",
        fontSize: 11, fontFamily: "inherit",
        outline: "none", boxSizing: "border-box",
      }}
    />
  );
}
