/**
 * TableNode — an interactive data table that outputs selected/filtered rows.
 *
 * This is the primary data primitive. It shows rows in a spreadsheet-like view.
 * Users can:
 * - Click a row to send just that row downstream
 * - Select "All" to send the entire array
 * - Filter by a condition expression
 *
 * Output port sends JSON (single row object or array of rows).
 */

import {
  HTMLContainer,
  Rectangle2d,
  ShapeUtil,
  T,
  TLBaseShape,
  Vec,
} from "tldraw";
import { useState } from "react";

export type TableNodeShape = TLBaseShape<
  "table-node",
  {
    w: number;
    h: number;
    label: string;
    dataJson: string;    // JSON array of row objects
    selectedRow: number; // -1 = all rows, 0+ = specific row index
    filterExpr: string;  // expression to filter rows (empty = no filter)
    outputMode: string;  // 'selected' | 'all' | 'filtered'
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
      w: 320,
      h: 240,
      label: "Table",
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
    return new Rectangle2d({
      width: shape.props.w,
      height: shape.props.h,
      isFilled: true,
    });
  }

  override canBind() { return true; }

  override getHandleSnapGeometry(shape: TableNodeShape) {
    return {
      points: [
        new Vec(0, shape.props.h / 2),         // input (left) — for receiving data
        new Vec(shape.props.w, shape.props.h / 2), // output (right) — sends rows
      ],
    };
  }

  override component(shape: TableNodeShape) {
    return <TableNodeComponent shape={shape} />;
  }

  override indicator(shape: TableNodeShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={8} />;
  }

  override canResize() { return true; }

  override onResize(shape: TableNodeShape, info: { scaleX: number; scaleY: number }) {
    return {
      props: {
        w: Math.max(200, shape.props.w * info.scaleX),
        h: Math.max(120, shape.props.h * info.scaleY),
      },
    };
  }
}

// ── Table Component ──────────────────────────────────────────────────────────

function TableNodeComponent({ shape }: { shape: TableNodeShape }) {
  const { w, h, label, dataJson, selectedRow, outputMode } = shape.props;

  let rows: Record<string, unknown>[] = [];
  try { rows = JSON.parse(dataJson); } catch { /* invalid */ }

  const columns = rows.length > 0 ? Object.keys(rows[0]) : [];

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
          height: 32, padding: "0 10px",
          background: "#1e293b",
          borderBottom: "1px solid #334155",
          display: "flex", alignItems: "center", gap: 6,
          fontSize: 11, fontWeight: 600, color: "#94a3b8",
          flexShrink: 0,
        }}>
          <span style={{ width: 6, height: 6, borderRadius: 2, background: "#3b82f6" }} />
          <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {label}
          </span>
          <span style={{ fontSize: 9, color: "#475569" }}>
            {rows.length} rows
          </span>
          <ModeIndicator mode={outputMode} />
        </div>

        {/* Table */}
        <div style={{ flex: 1, overflow: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
            <thead>
              <tr>
                <th style={thStyle}>#</th>
                {columns.map(col => (
                  <th key={col} style={thStyle}>{col}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr
                  key={i}
                  style={{
                    background: selectedRow === i ? "#1e3a5f" : i % 2 === 0 ? "transparent" : "#0c1220",
                    cursor: "pointer",
                  }}
                >
                  <td style={{ ...tdStyle, color: "#475569", width: 28 }}>{i}</td>
                  {columns.map(col => (
                    <td key={col} style={tdStyle}>
                      {String(row[col] ?? "")}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div style={{
          height: 24, padding: "0 10px",
          borderTop: "1px solid #1e293b",
          display: "flex", alignItems: "center", gap: 6,
          fontSize: 9, color: "#475569", flexShrink: 0,
        }}>
          <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#22c55e" }} />
          {outputMode === "all" ? `Sending ${rows.length} rows` :
           outputMode === "selected" && selectedRow >= 0 ? `Sending row ${selectedRow}` :
           "Sending all"}
        </div>

        {/* Input port (left) */}
        <div style={{
          position: "absolute", left: -5, top: "50%", transform: "translateY(-50%)",
          width: 10, height: 10, borderRadius: "50%",
          background: "#06b6d4", border: "2px solid #0f172a",
        }} />

        {/* Output port (right) */}
        <div style={{
          position: "absolute", right: -5, top: "50%", transform: "translateY(-50%)",
          width: 10, height: 10, borderRadius: "50%",
          background: "#3b82f6", border: "2px solid #0f172a",
        }} />
      </div>
    </HTMLContainer>
  );
}

function ModeIndicator({ mode }: { mode: string }) {
  const colors: Record<string, string> = {
    all: "#3b82f6",
    selected: "#f59e0b",
    filtered: "#8b5cf6",
  };
  return (
    <span style={{
      fontSize: 8, padding: "1px 4px", borderRadius: 3,
      background: colors[mode] || "#475569",
      color: "#fff", textTransform: "uppercase", letterSpacing: "0.05em",
    }}>
      {mode}
    </span>
  );
}

const thStyle: React.CSSProperties = {
  padding: "5px 8px", textAlign: "left",
  borderBottom: "1px solid #1e293b",
  color: "#64748b", fontWeight: 500,
  position: "sticky", top: 0,
  background: "#0f172a",
};

const tdStyle: React.CSSProperties = {
  padding: "4px 8px",
  borderBottom: "1px solid #0c1220",
  color: "#cbd5e1",
};
