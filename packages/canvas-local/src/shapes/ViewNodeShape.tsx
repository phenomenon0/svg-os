/**
 * ViewNode — renders SVG template content with NO wrapper chrome.
 * The template IS the node. Input port on the left edge only.
 */

import {
  HTMLContainer,
  Rectangle2d,
  ShapeUtil,
  T,
  TLBaseShape,
  Vec,
} from "tldraw";
import { Port } from "../Port";

export type ViewNodeShape = TLBaseShape<
  "view-node",
  {
    w: number;
    h: number;
    viewType: string;
    typeId: string;
    renderedContent: string;
    variant: string;
    htmlTitle: string;
    htmlContent: string;
    data: string;
  }
>;

export class ViewNodeShapeUtil extends ShapeUtil<ViewNodeShape> {
  static override type = "view-node" as const;

  static override props = {
    w: T.number,
    h: T.number,
    viewType: T.string,
    typeId: T.string,
    renderedContent: T.string,
    variant: T.string,
    htmlTitle: T.string,
    htmlContent: T.string,
    data: T.string,
  };

  getDefaultProps(): ViewNodeShape["props"] {
    return {
      w: 280,
      h: 200,
      viewType: "svg-template",
      typeId: "",
      renderedContent: "",
      variant: "",
      htmlTitle: "",
      htmlContent: "",
      data: "",
    };
  }

  override getGeometry(shape: ViewNodeShape) {
    return new Rectangle2d({
      width: shape.props.w,
      height: shape.props.h,
      isFilled: true,
    });
  }

  override canBind() {
    return true;
  }

  override getHandleSnapGeometry(shape: ViewNodeShape) {
    return {
      points: [new Vec(0, shape.props.h / 2)],
    };
  }

  override component(shape: ViewNodeShape) {
    const { w, h, renderedContent } = shape.props;

    return (
      <HTMLContainer
        style={{
          width: w,
          height: h,
          pointerEvents: "all",
          position: "relative",
          overflow: "hidden",
          borderRadius: 8,
        }}
      >
        <Port side="left" type="data" name="data" shapeId={shape.id} />
        <SvgView w={w} h={h} content={renderedContent} />
      </HTMLContainer>
    );
  }

  override indicator(shape: ViewNodeShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={8} />;
  }

  override canResize() {
    return true;
  }

  override onResize(shape: ViewNodeShape, info: { scaleX: number; scaleY: number }) {
    return {
      props: {
        w: Math.max(80, shape.props.w * info.scaleX),
        h: Math.max(60, shape.props.h * info.scaleY),
      },
    };
  }
}

// -- SVG View --

function SvgView({ w, h, content }: { w: number; h: number; content: string }) {
  if (!content) {
    return (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: "#0f172a",
          border: "1px solid #334155",
          borderRadius: 8,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#334155",
          fontSize: 11,
          fontFamily: "'Inter', system-ui, sans-serif",
        }}
      >
        No data
      </div>
    );
  }

  const vb = parseViewBox(content, w, h);

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        background: "#0c1220",
        borderRadius: 8,
        overflow: "hidden",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
      dangerouslySetInnerHTML={{
        __html: `<svg width="100%" height="100%" viewBox="${vb}" preserveAspectRatio="xMidYMid meet">${extractSvgInner(content)}</svg>`,
      }}
    />
  );
}

// -- SVG Helpers --

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
    const nums = vb[1]
      .trim()
      .split(/[\s,]+/)
      .map(Number);
    if (nums.length === 4 && nums.every((n) => !isNaN(n))) {
      return nums.join(" ");
    }
  }
  const wm = svg.match(/\bwidth\s*=\s*"(\d+(?:\.\d+)?)"/);
  const hm = svg.match(/\bheight\s*=\s*"(\d+(?:\.\d+)?)"/);
  return `0 0 ${wm ? wm[1] : fw} ${hm ? hm[1] : fh}`;
}
