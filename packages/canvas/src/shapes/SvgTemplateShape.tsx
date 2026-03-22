/**
 * SvgTemplateShape — renders SVG OS templates as Houdini/TD-style nodes.
 *
 * Features:
 * - Header bar with node type name and status indicators
 * - Input/output port circles on left/right edges
 * - Live SVG preview of the template content
 * - Status strip with cook indicator and slot count
 */

import {
  HTMLContainer,
  Rectangle2d,
  ShapeUtil,
  T,
  TLBaseShape,
  TLHandle,
} from "tldraw";

export type SvgTemplateShape = TLBaseShape<
  "svg-template",
  {
    w: number;
    h: number;
    typeId: string;
    svgContent: string;
  }
>;

export class SvgTemplateShapeUtil extends ShapeUtil<SvgTemplateShape> {
  static override type = "svg-template" as const;

  static override props = {
    w: T.number,
    h: T.number,
    typeId: T.string,
    svgContent: T.string,
  };

  getDefaultProps(): SvgTemplateShape["props"] {
    return { w: 200, h: 160, typeId: "", svgContent: "" };
  }

  override getGeometry(shape: SvgTemplateShape) {
    return new Rectangle2d({
      width: shape.props.w,
      height: shape.props.h + 52, // +28 header +24 status
      isFilled: true,
    });
  }

  override getHandles(shape: SvgTemplateShape): TLHandle[] {
    const h = shape.props.h + 52;
    return [
      { id: "input", type: "vertex", index: "a0" as any, x: 0, y: h / 2, canSnap: true },
      { id: "output", type: "vertex", index: "a1" as any, x: shape.props.w, y: h / 2, canSnap: true },
    ];
  }

  override component(shape: SvgTemplateShape) {
    const { w, h, typeId, svgContent } = shape.props;
    const totalH = h + 52;

    return (
      <HTMLContainer style={{ width: w, height: totalH, pointerEvents: "all" }}>
        <div style={{
          width: "100%", height: "100%",
          background: "#0f172a",
          border: "1px solid #334155",
          borderRadius: 8,
          display: "flex", flexDirection: "column",
          overflow: "hidden",
          fontFamily: "'Inter', system-ui, sans-serif",
          position: "relative",
        }}>
          {/* Header */}
          <div style={{
            height: 28,
            padding: "0 10px",
            background: "#1e293b",
            borderBottom: "1px solid #334155",
            display: "flex", alignItems: "center", gap: 6,
            fontSize: 11, fontWeight: 600, color: "#94a3b8",
            flexShrink: 0,
          }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: "#f59e0b", flexShrink: 0 }} />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
              {typeId || "SVG Template"}
            </span>
            <span style={{ fontSize: 9, color: "#475569" }}>SVG</span>
          </div>

          {/* Content — SVG preview */}
          <div style={{ flex: 1, overflow: "hidden", position: "relative", background: "#0c1220" }}>
            {svgContent ? (
              <div
                style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}
                dangerouslySetInnerHTML={{
                  __html: `<svg width="100%" height="100%" viewBox="0 0 ${parseVB(svgContent, w, h)}" preserveAspectRatio="xMidYMid meet">${extractSvgInner(svgContent)}</svg>`
                }}
              />
            ) : (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#334155", fontSize: 12 }}>
                No template
              </div>
            )}
          </div>

          {/* Status bar */}
          <div style={{
            height: 24,
            padding: "0 10px",
            borderTop: "1px solid #334155",
            display: "flex", alignItems: "center", gap: 8,
            fontSize: 10, color: "#475569",
            flexShrink: 0,
          }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#22c55e" }} />
            <span>Ready</span>
            <span style={{ marginLeft: "auto" }}>SVG</span>
          </div>

          {/* Input port */}
          <div style={{
            position: "absolute", left: -6, top: "50%", transform: "translateY(-50%)",
            width: 12, height: 12, borderRadius: "50%",
            background: "#06b6d4", border: "2px solid #0f172a",
            cursor: "crosshair",
          }} />

          {/* Output port */}
          <div style={{
            position: "absolute", right: -6, top: "50%", transform: "translateY(-50%)",
            width: 12, height: 12, borderRadius: "50%",
            background: "#f59e0b", border: "2px solid #0f172a",
            cursor: "crosshair",
          }} />
        </div>
      </HTMLContainer>
    );
  }

  override indicator(shape: SvgTemplateShape) {
    return <rect width={shape.props.w} height={shape.props.h + 52} rx={8} />;
  }

  override canResize() { return true; }

  override onResize(shape: SvgTemplateShape, info: { scaleX: number; scaleY: number }) {
    return {
      props: {
        w: Math.max(120, shape.props.w * info.scaleX),
        h: Math.max(60, shape.props.h * info.scaleY),
      },
    };
  }
}

function extractSvgInner(svg: string): string {
  const openMatch = svg.match(/<svg[^>]*>/);
  if (!openMatch) return svg;
  const start = openMatch.index! + openMatch[0].length;
  const end = svg.lastIndexOf("</svg>");
  return end === -1 ? svg.slice(start) : svg.slice(start, end);
}

function parseVB(svg: string, fw: number, fh: number): string {
  const vb = svg.match(/viewBox="([^"]+)"/);
  if (vb) {
    const parts = vb[1].trim().split(/[\s,]+/);
    if (parts.length === 4) return vb[1];
  }
  const w = svg.match(/width="(\d+(?:\.\d+)?)"/);
  const h = svg.match(/height="(\d+(?:\.\d+)?)"/);
  return `0 0 ${w ? w[1] : fw} ${h ? h[1] : fh}`;
}
