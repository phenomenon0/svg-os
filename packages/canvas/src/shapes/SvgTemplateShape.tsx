/**
 * SvgTemplateShape — renders any SVG OS template as a tldraw shape.
 *
 * Each instance holds a typeId (which template) and rendered SVG content.
 * The SVG is pre-rendered by the WASM engine with data bindings resolved.
 */

import { Rectangle2d, ShapeUtil, SVGContainer, T, TLBaseShape } from "tldraw";

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
    return {
      w: 160,
      h: 80,
      typeId: "",
      svgContent: "",
    };
  }

  override getGeometry(shape: SvgTemplateShape) {
    return new Rectangle2d({
      width: shape.props.w,
      height: shape.props.h,
      isFilled: true,
    });
  }

  override component(shape: SvgTemplateShape) {
    const { w, h, svgContent } = shape.props;

    if (!svgContent) {
      // Placeholder when no content
      return (
        <SVGContainer>
          <rect
            width={w}
            height={h}
            rx={8}
            fill="#1e293b"
            stroke="#475569"
            strokeWidth={2}
          />
          <text
            x={w / 2}
            y={h / 2 + 5}
            textAnchor="middle"
            fill="#64748b"
            fontSize={12}
            fontFamily="Inter, sans-serif"
          >
            {shape.props.typeId || "Empty"}
          </text>
        </SVGContainer>
      );
    }

    return (
      <SVGContainer>
        <g
          transform={`scale(${w / parseViewBoxWidth(svgContent, w)} ${h / parseViewBoxHeight(svgContent, h)})`}
          dangerouslySetInnerHTML={{ __html: extractSvgInner(svgContent) }}
        />
      </SVGContainer>
    );
  }

  override indicator(shape: SvgTemplateShape) {
    return (
      <rect
        width={shape.props.w}
        height={shape.props.h}
        rx={8}
      />
    );
  }

  override canResize() {
    return true;
  }

  override onResize(shape: SvgTemplateShape, info: { newPoint: { x: number; y: number }; handle: string; scaleX: number; scaleY: number }) {
    return {
      props: {
        w: Math.max(40, shape.props.w * info.scaleX),
        h: Math.max(40, shape.props.h * info.scaleY),
      },
    };
  }
}

/**
 * Extract the inner content of an SVG string (everything inside <svg>...</svg>).
 */
function extractSvgInner(svg: string): string {
  // Remove the outer <svg> and </svg> tags
  const openMatch = svg.match(/<svg[^>]*>/);
  if (!openMatch) return svg;
  const start = openMatch.index! + openMatch[0].length;
  const end = svg.lastIndexOf("</svg>");
  if (end === -1) return svg.slice(start);
  return svg.slice(start, end);
}

/**
 * Parse the viewBox or width from an SVG string.
 */
function parseViewBoxWidth(svg: string, fallback: number): number {
  const vb = svg.match(/viewBox="([^"]+)"/);
  if (vb) {
    const parts = vb[1].split(/[\s,]+/);
    if (parts.length >= 4) return parseFloat(parts[2]) || fallback;
  }
  const w = svg.match(/width="(\d+(?:\.\d+)?)"/);
  return w ? parseFloat(w[1]) : fallback;
}

function parseViewBoxHeight(svg: string, fallback: number): number {
  const vb = svg.match(/viewBox="([^"]+)"/);
  if (vb) {
    const parts = vb[1].split(/[\s,]+/);
    if (parts.length >= 4) return parseFloat(parts[3]) || fallback;
  }
  const h = svg.match(/height="(\d+(?:\.\d+)?)"/);
  return h ? parseFloat(h[1]) : fallback;
}
