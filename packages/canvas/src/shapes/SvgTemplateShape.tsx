/**
 * SvgTemplateShape — renders SVG OS templates with Houdini/TD-style node chrome.
 *
 * - canBind: true — arrows snap and attach to this shape
 * - getHandleSnapGeometry: port positions for arrow snapping
 * - Compact header + live preview + status strip
 */

import {
  HTMLContainer,
  Rectangle2d,
  ShapeUtil,
  T,
  TLBaseShape,
  Vec,
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

const HEADER_H = 24;
const STATUS_H = 20;
const CHROME_H = HEADER_H + STATUS_H;

export class SvgTemplateShapeUtil extends ShapeUtil<SvgTemplateShape> {
  static override type = "svg-template" as const;

  static override props = {
    w: T.number,
    h: T.number,
    typeId: T.string,
    svgContent: T.string,
  };

  getDefaultProps(): SvgTemplateShape["props"] {
    return { w: 160, h: 100, typeId: "", svgContent: "" };
  }

  override getGeometry(shape: SvgTemplateShape) {
    return new Rectangle2d({
      width: shape.props.w,
      height: shape.props.h + CHROME_H,
      isFilled: true,
    });
  }

  // Allow arrows to bind to this shape
  override canBind() { return true; }

  // Snap points for arrow endpoints
  override getHandleSnapGeometry(shape: SvgTemplateShape) {
    const totalH = shape.props.h + CHROME_H;
    return {
      points: [
        new Vec(0, totalH / 2),
        new Vec(shape.props.w, totalH / 2),
      ],
    };
  }

  override component(shape: SvgTemplateShape) {
    const { w, h, typeId, svgContent } = shape.props;
    const totalH = h + CHROME_H;
    const vb = parseViewBox(svgContent, w, h);

    return (
      <HTMLContainer style={{ width: w, height: totalH, pointerEvents: "all" }}>
        <div style={{
          width: "100%", height: "100%",
          background: "#0f172a", border: "1px solid #334155",
          borderRadius: 6, display: "flex", flexDirection: "column",
          overflow: "hidden", fontFamily: "'Inter', system-ui, sans-serif",
          position: "relative",
        }}>
          {/* Header */}
          <div style={{
            height: HEADER_H, padding: "0 8px",
            background: "#1e293b", borderBottom: "1px solid #334155",
            display: "flex", alignItems: "center", gap: 4,
            fontSize: 10, fontWeight: 600, color: "#94a3b8", flexShrink: 0,
          }}>
            <span style={{ width: 6, height: 6, borderRadius: 2, background: "#f59e0b" }} />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
              {typeId || "Template"}
            </span>
          </div>

          {/* SVG preview */}
          <div style={{ flex: 1, overflow: "hidden", background: "#0c1220" }}>
            {svgContent ? (
              <div
                style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}
                dangerouslySetInnerHTML={{
                  __html: `<svg width="100%" height="100%" viewBox="${vb}" preserveAspectRatio="xMidYMid meet">${extractSvgInner(svgContent)}</svg>`
                }}
              />
            ) : (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#334155", fontSize: 11 }}>
                Empty
              </div>
            )}
          </div>

          {/* Status */}
          <div style={{
            height: STATUS_H, padding: "0 8px",
            borderTop: "1px solid #1e293b",
            display: "flex", alignItems: "center", gap: 4,
            fontSize: 9, color: "#475569", flexShrink: 0,
          }}>
            <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#22c55e" }} />
            Ready
          </div>

          {/* Port: input (left) */}
          <div style={{
            position: "absolute", left: -5, top: "50%", transform: "translateY(-50%)",
            width: 10, height: 10, borderRadius: "50%",
            background: "#06b6d4", border: "2px solid #0f172a",
          }} />
          {/* Port: output (right) */}
          <div style={{
            position: "absolute", right: -5, top: "50%", transform: "translateY(-50%)",
            width: 10, height: 10, borderRadius: "50%",
            background: "#f59e0b", border: "2px solid #0f172a",
          }} />
        </div>
      </HTMLContainer>
    );
  }

  override indicator(shape: SvgTemplateShape) {
    return <rect width={shape.props.w} height={shape.props.h + CHROME_H} rx={6} />;
  }

  override canResize() { return true; }

  override onResize(shape: SvgTemplateShape, info: { scaleX: number; scaleY: number }) {
    return {
      props: {
        w: Math.max(80, shape.props.w * info.scaleX),
        h: Math.max(40, shape.props.h * info.scaleY),
      },
    };
  }
}

function extractSvgInner(svg: string): string {
  const open = svg.match(/<svg[^>]*>/);
  if (!open) return svg;
  const start = open.index! + open[0].length;
  const end = svg.lastIndexOf("</svg>");
  return end === -1 ? svg.slice(start) : svg.slice(start, end);
}

function parseViewBox(svg: string, fw: number, fh: number): string {
  const vb = svg.match(/viewBox\s*=\s*"([^"]+)"/);
  if (vb) {
    const nums = vb[1].trim().split(/[\s,]+/).map(Number);
    if (nums.length === 4 && nums.every(n => !isNaN(n))) {
      return nums.join(" ");
    }
  }
  const wm = svg.match(/\bwidth\s*=\s*"(\d+(?:\.\d+)?)"/);
  const hm = svg.match(/\bheight\s*=\s*"(\d+(?:\.\d+)?)"/);
  return `0 0 ${wm ? wm[1] : fw} ${hm ? hm[1] : fh}`;
}
