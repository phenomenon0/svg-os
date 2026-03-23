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
import { listNodeTypes } from "@svg-os/bridge";

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
      dataJson: "[]",
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
    const suggestions = ["name", "value", "type", "status", "score", "color", "label", "url", "team", "position"];
    const used = new Set(columns);
    const name = suggestions.find(s => !used.has(s)) || `field${columns.length + 1}`;
    if (rows.length === 0) {
      updateData([{ [name]: "" }]);
    } else {
      updateData(rows.map(row => ({ ...row, [name]: "" })));
    }
  }, [rows, columns, updateData]);

  const deleteRow = useCallback((idx: number) => {
    const newRows = rows.filter((_, i) => i !== idx);
    updateData(newRows);
  }, [rows, updateData]);

  const autoPopulate = useCallback((rowCount = 5) => {
    const newRows: Record<string, unknown>[] = [];
    for (let i = 0; i < rowCount; i++) {
      const row: Record<string, unknown> = {};
      columns.forEach(col => { row[col] = generateDummy(col); });
      newRows.push(row);
    }
    updateData(newRows);
  }, [columns, updateData]);

  // Check if connected downstream View needs specific columns
  const inheritColumnsFromView = useCallback(() => {
    const shapes = editor.getCurrentPageShapes();
    const arrows = shapes.filter((s: any) => s.type === "arrow");

    for (const arrow of arrows) {
      const bindings = editor.getBindingsFromShape(arrow.id, "arrow");
      const startB = bindings.find((b: any) => b.props?.terminal === "start");
      const endB = bindings.find((b: any) => b.props?.terminal === "end");

      if (startB?.toId === shape.id && endB) {
        const targetShape = editor.getShape(endB.toId);
        if (targetShape?.type === "view-node") {
          const typeId = (targetShape.props as any).typeId;
          if (typeId) {
            try {
              const types = listNodeTypes();
              const nt = types.find((t: any) => t.id === typeId);
              if (nt?.slots) {
                const slotFields = nt.slots.map((s: any) => s.field);
                const newCols = slotFields.filter((f: string) => !columns.includes(f));
                if (newCols.length > 0) {
                  const newRows = rows.map(row => {
                    const updated = { ...row };
                    newCols.forEach((c: string) => { updated[c] = ""; });
                    return updated;
                  });
                  updateData(newRows);
                }
              }
            } catch { /* */ }
          }
        }
      }
    }
  }, [editor, shape.id, rows, columns, updateData]);

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
          {columns.length === 0 ? (
            <div style={{
              height: "100%", display: "flex", flexDirection: "column",
              alignItems: "center", justifyContent: "center", gap: 8,
              color: "#475569", fontSize: 11,
            }}>
              <div>Empty table</div>
              <div style={{ fontSize: 10, color: "#334155" }}>
                Click <b>+</b> to add columns, or connect to a View and click <b>⇄ Sync</b>
              </div>
            </div>
          ) : (
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
          )}
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
            onPointerDown={(e) => e.stopPropagation()}
            style={{ ...addBtnStyle, padding: "2px 8px", fontSize: 10 }}
          >+ Row</button>
          <button
            onClick={(e) => { e.stopPropagation(); autoPopulate(5); }}
            onPointerDown={(e) => e.stopPropagation()}
            style={{ ...addBtnStyle, padding: "2px 8px", fontSize: 10, color: "#f59e0b" }}
            title="Fill with dummy data based on column names"
          >Auto-fill</button>
          <button
            onClick={(e) => { e.stopPropagation(); inheritColumnsFromView(); }}
            onPointerDown={(e) => e.stopPropagation()}
            style={{ ...addBtnStyle, padding: "2px 8px", fontSize: 10, color: "#06b6d4" }}
            title="Add columns needed by connected View"
          >⇄ Sync</button>
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

// ── Dummy Data Bank ──────────────────────────────────────────────────────────

const DUMMY_BANK: Record<string, () => unknown> = {
  // Names
  name: () => pick(["Pedri", "Salah", "Haaland", "Messi", "Mbappé", "Rodri", "Bellingham", "Vinicius", "De Bruyne", "Saka"]),
  player: () => DUMMY_BANK.name(),
  first_name: () => pick(["Marcus", "Luka", "Jadon", "Erling", "Kylian", "Jude", "Phil", "Bukayo"]),
  last_name: () => pick(["Rashford", "Modric", "Sancho", "Haaland", "Mbappé", "Bellingham", "Foden", "Saka"]),
  team: () => pick(["Barcelona", "Liverpool", "Man City", "Real Madrid", "PSG", "Bayern", "Arsenal", "Chelsea"]),
  team_a: () => DUMMY_BANK.team(),
  team_b: () => DUMMY_BANK.team(),

  // Football
  position: () => pick(["GK", "CB", "LB", "RB", "DM", "CM", "AM", "LW", "RW", "ST"]),
  score: () => randInt(60, 99),
  goals: () => randInt(0, 30),
  assists: () => randInt(0, 20),
  appearances: () => randInt(10, 50),
  rating: () => randInt(60, 99),
  overall: () => randInt(70, 99),
  pace: () => randInt(50, 99),
  pac: () => randInt(50, 99),
  sho: () => randInt(40, 99),
  pas: () => randInt(50, 99),
  dri: () => randInt(50, 99),
  def: () => randInt(30, 99),
  phy: () => randInt(40, 99),
  age: () => randInt(17, 38),
  number: () => randInt(1, 99),
  value: () => `€${randInt(5, 200)}M`,

  // Colors
  color: () => pick(["#3b82f6", "#ef4444", "#22c55e", "#f59e0b", "#8b5cf6", "#ec4899", "#06b6d4"]),
  fill: () => DUMMY_BANK.color(),
  accent: () => DUMMY_BANK.color(),
  color_a: () => DUMMY_BANK.color(),
  color_b: () => DUMMY_BANK.color(),
  background: () => DUMMY_BANK.color(),
  team_color: () => DUMMY_BANK.color(),

  // Text
  title: () => pick(["Season Review", "Match Report", "Transfer News", "Injury Update", "Tactical Analysis"]),
  label: () => pick(["Primary", "Secondary", "Featured", "Spotlight", "Rising Star"]),
  description: () => pick(["Outstanding performance", "Key player this season", "Breakthrough talent", "Consistent performer"]),
  status: () => pick(["active", "injured", "suspended", "on loan", "available"]),
  tournament: () => pick(["Champions League", "Premier League", "La Liga", "World Cup", "Europa League"]),
  stage: () => pick(["Group Stage", "Quarter-final", "Semi-final", "Final", "Round of 16"]),
  date: () => `2025-${String(randInt(1, 12)).padStart(2, "0")}-${String(randInt(1, 28)).padStart(2, "0")}`,
  game: () => pick(["Match Day 12", "Gameweek 28", "Round 3", "Fixture 15"]),
  broadcast: () => pick(["Sky Sports", "BT Sport", "ESPN", "DAZN", "beIN Sports"]),

  // Numbers
  score_a: () => randInt(0, 5),
  score_b: () => randInt(0, 5),
  width: () => randInt(100, 400),
  height: () => randInt(100, 400),
  progress: () => randInt(0, 100),

  // URLs
  url: () => `https://example.com/${randInt(1, 999)}`,
  image: () => `https://picsum.photos/${randInt(200, 400)}`,
  avatar: () => DUMMY_BANK.image!(),
  avatar_url: () => DUMMY_BANK.image!(),
};

function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }
function randInt(min: number, max: number): number { return Math.floor(Math.random() * (max - min + 1)) + min; }

function generateDummy(col: string): unknown {
  const key = col.toLowerCase().replace(/[\s-]/g, "_");
  if (DUMMY_BANK[key]) return DUMMY_BANK[key]();
  // Guess from partial match
  for (const [k, fn] of Object.entries(DUMMY_BANK)) {
    if (key.includes(k) || k.includes(key)) return fn();
  }
  return `${col}_${randInt(1, 100)}`;
}

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
