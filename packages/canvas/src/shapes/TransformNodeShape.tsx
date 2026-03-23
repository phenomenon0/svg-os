/**
 * TransformNode — a compact pill that transforms data via expression.
 * Input port on the left, output port on the right.
 * Purple accent (#8b5cf6).
 */

import {
  HTMLContainer,
  Rectangle2d,
  ShapeUtil,
  T,
  TLBaseShape,
  Vec,
} from "tldraw";

export type TransformNodeShape = TLBaseShape<
  "transform-node",
  {
    w: number;
    h: number;
    expression: string;
    label: string;
  }
>;

export class TransformNodeShapeUtil extends ShapeUtil<TransformNodeShape> {
  static override type = "transform-node" as const;

  static override props = {
    w: T.number,
    h: T.number,
    expression: T.string,
    label: T.string,
  };

  getDefaultProps(): TransformNodeShape["props"] {
    return { w: 180, h: 48, expression: "$.value", label: "Transform" };
  }

  override getGeometry(shape: TransformNodeShape) {
    return new Rectangle2d({
      width: shape.props.w,
      height: shape.props.h,
      isFilled: true,
    });
  }

  override canBind() {
    return true;
  }

  override getHandleSnapGeometry(shape: TransformNodeShape) {
    return {
      points: [
        new Vec(0, shape.props.h / 2),            // input port left
        new Vec(shape.props.w, shape.props.h / 2), // output port right
      ],
    };
  }

  override component(shape: TransformNodeShape) {
    const { w, h, label, expression } = shape.props;
    const maxExprLen = Math.max(8, Math.floor((w - 100) / 6));
    const truncExpr =
      expression.length > maxExprLen
        ? expression.slice(0, maxExprLen) + "\u2026"
        : expression;

    return (
      <HTMLContainer style={{ width: w, height: h, pointerEvents: "all" }}>
        <div
          style={{
            width: "100%",
            height: "100%",
            borderRadius: 24,
            background: "#1e1b2e",
            border: "1px solid #6d28d9",
            display: "flex",
            alignItems: "center",
            padding: "0 16px",
            gap: 8,
            fontFamily: "'Inter', system-ui, sans-serif",
            position: "relative",
          }}
        >
          {/* Input port */}
          <div
            style={{
              position: "absolute",
              left: -5,
              top: "50%",
              transform: "translateY(-50%)",
              width: 10,
              height: 10,
              borderRadius: "50%",
              background: "#8b5cf6",
              border: "2px solid #0f172a",
            }}
          />
          <div
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: "#8b5cf6",
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
              flexShrink: 0,
            }}
          >
            {label}
          </div>
          <div
            style={{
              fontSize: 10,
              color: "#7c3aed",
              marginLeft: "auto",
              fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {truncExpr}
          </div>
          {/* Output port */}
          <div
            style={{
              position: "absolute",
              right: -5,
              top: "50%",
              transform: "translateY(-50%)",
              width: 10,
              height: 10,
              borderRadius: "50%",
              background: "#8b5cf6",
              border: "2px solid #0f172a",
            }}
          />
        </div>
      </HTMLContainer>
    );
  }

  override indicator(shape: TransformNodeShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={24} />;
  }

  override canResize() {
    return true;
  }

  override onResize(shape: TransformNodeShape, info: { scaleX: number; scaleY: number }) {
    return {
      props: {
        w: Math.max(120, shape.props.w * info.scaleX),
        h: 48,
      },
    };
  }
}
