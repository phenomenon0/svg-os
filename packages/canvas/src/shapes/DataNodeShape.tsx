/**
 * DataNode — a compact pill that produces JSON data.
 * No visual output beyond label + data preview.
 * Output port on the right edge.
 */

import {
  HTMLContainer,
  Rectangle2d,
  ShapeUtil,
  T,
  TLBaseShape,
  Vec,
} from "tldraw";

export type DataNodeShape = TLBaseShape<
  "data-node",
  {
    w: number;
    h: number;
    dataJson: string;
    label: string;
  }
>;

export class DataNodeShapeUtil extends ShapeUtil<DataNodeShape> {
  static override type = "data-node" as const;

  static override props = {
    w: T.number,
    h: T.number,
    dataJson: T.string,
    label: T.string,
  };

  getDefaultProps(): DataNodeShape["props"] {
    return { w: 160, h: 48, dataJson: "{}", label: "Data" };
  }

  override getGeometry(shape: DataNodeShape) {
    return new Rectangle2d({
      width: shape.props.w,
      height: shape.props.h,
      isFilled: true,
    });
  }

  override canBind() {
    return true;
  }

  override getHandleSnapGeometry(shape: DataNodeShape) {
    return {
      points: [new Vec(shape.props.w, shape.props.h / 2)],
    };
  }

  override component(shape: DataNodeShape) {
    const { w, h, label, dataJson } = shape.props;
    let preview = "";
    try {
      const d = JSON.parse(dataJson);
      const keys = Object.keys(d);
      preview = keys.length > 0 ? `${keys.length} fields` : "empty";
    } catch {
      preview = "invalid";
    }

    return (
      <HTMLContainer style={{ width: w, height: h, pointerEvents: "all" }}>
        <div
          style={{
            width: "100%",
            height: "100%",
            borderRadius: 24,
            background: "#1e293b",
            border: "1px solid #475569",
            display: "flex",
            alignItems: "center",
            padding: "0 12px",
            gap: 8,
            fontFamily: "'Inter', system-ui, sans-serif",
            position: "relative",
          }}
        >
          <div
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: "#22c55e",
              flexShrink: 0,
            }}
          />
          <div
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: "#e2e8f0",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {label}
          </div>
          <div style={{ fontSize: 10, color: "#64748b", marginLeft: "auto" }}>
            {preview}
          </div>
          {/* Output port */}
          <div
            style={{
              position: "absolute",
              right: -7,
              top: "50%",
              transform: "translateY(-50%)",
              width: 10,
              height: 10,
              borderRadius: "50%",
              background: "#22c55e",
              border: "2px solid #0f172a",
            }}
          />
        </div>
      </HTMLContainer>
    );
  }

  override indicator(shape: DataNodeShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={24} />;
  }

  override canResize() {
    return true;
  }

  override onResize(shape: DataNodeShape, info: { scaleX: number; scaleY: number }) {
    return {
      props: {
        w: Math.max(100, shape.props.w * info.scaleX),
        h: 48,
      },
    };
  }
}
