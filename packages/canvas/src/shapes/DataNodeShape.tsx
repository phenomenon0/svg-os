/**
 * DataNode — a compact pill that produces JSON data.
 * Output port on the right edge. Drag from it to connect.
 */

import { HTMLContainer, Rectangle2d, ShapeUtil, T, TLBaseShape, Vec } from "tldraw";
import { Port } from "../Port";

export type DataNodeShape = TLBaseShape<
  "data-node",
  { w: number; h: number; dataJson: string; label: string }
>;

export class DataNodeShapeUtil extends ShapeUtil<DataNodeShape> {
  static override type = "data-node" as const;
  static override props = { w: T.number, h: T.number, dataJson: T.string, label: T.string };

  getDefaultProps(): DataNodeShape["props"] {
    return { w: 160, h: 48, dataJson: "{}", label: "Data" };
  }

  override getGeometry(shape: DataNodeShape) {
    return new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: true });
  }

  override canBind() { return true; }
  override canEdit() { return false; }

  override getHandleSnapGeometry(shape: DataNodeShape) {
    return { points: [new Vec(shape.props.w, shape.props.h / 2)] };
  }

  override component(shape: DataNodeShape) {
    const { w, h, label, dataJson } = shape.props;
    let preview = "";
    try {
      const d = JSON.parse(dataJson);
      preview = Array.isArray(d) ? `${d.length} rows` : `${Object.keys(d).length} fields`;
    } catch { preview = "invalid"; }

    return (
      <HTMLContainer style={{ width: w, height: h, pointerEvents: "all" }}>
        <div style={{
          width: "100%", height: "100%", borderRadius: 24,
          background: "#1e293b", border: "1px solid #475569",
          display: "flex", alignItems: "center", padding: "0 12px", gap: 8,
          fontFamily: "'Inter', system-ui, sans-serif", position: "relative",
        }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#22c55e", flexShrink: 0 }} />
          <div style={{ fontSize: 12, fontWeight: 600, color: "#e2e8f0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</div>
          <div style={{ fontSize: 10, color: "#64748b", marginLeft: "auto" }}>{preview}</div>
          <Port side="right" color="#22c55e" shapeId={shape.id} />
        </div>
      </HTMLContainer>
    );
  }

  override indicator(shape: DataNodeShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={24} />;
  }

  override canResize() { return true; }
  override onResize(shape: DataNodeShape, info: { scaleX: number; scaleY: number }) {
    return { props: { w: Math.max(100, shape.props.w * info.scaleX), h: 48 } };
  }
}
