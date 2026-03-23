/**
 * MultiplexerNode — takes an array input and renders N views in parallel.
 *
 * When connected to a Table Node, it renders each row as a separate view.
 * Max 5 views rendered simultaneously (configurable).
 * Each view shows its row data rendered through the selected template.
 *
 * Think: "for each row in the table, render a scouting card"
 */

import {
  HTMLContainer,
  Rectangle2d,
  ShapeUtil,
  T,
  TLBaseShape,
  Vec,
} from "tldraw";
import { listNodeTypes, getNodeType, renderTemplateInline } from "@svg-os/bridge";
import { Port } from "../Port";

export type MultiplexerNodeShape = TLBaseShape<
  "multiplexer-node",
  {
    w: number;
    h: number;
    label: string;
    templateId: string;   // which view template to use for each item
    maxItems: number;      // max simultaneous renders (default 5)
    inputDataJson: string; // received array data (set by reactive engine)
  }
>;

export class MultiplexerNodeShapeUtil extends ShapeUtil<MultiplexerNodeShape> {
  static override type = "multiplexer-node" as const;

  static override props = {
    w: T.number,
    h: T.number,
    label: T.string,
    templateId: T.string,
    maxItems: T.number,
    inputDataJson: T.string,
  };

  getDefaultProps(): MultiplexerNodeShape["props"] {
    return {
      w: 600,
      h: 300,
      label: "Multiplexer",
      templateId: "",
      maxItems: 5,
      inputDataJson: "[]",
    };
  }

  override getGeometry(shape: MultiplexerNodeShape) {
    return new Rectangle2d({
      width: shape.props.w,
      height: shape.props.h,
      isFilled: true,
    });
  }

  override canBind() { return true; }
  override canEdit() { return false; }

  override getHandleSnapGeometry(shape: MultiplexerNodeShape) {
    return {
      points: [
        new Vec(0, shape.props.h / 2), // input (left)
      ],
    };
  }

  override component(shape: MultiplexerNodeShape) {
    return <MultiplexerComponent shape={shape} />;
  }

  override indicator(shape: MultiplexerNodeShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={8} />;
  }

  override canResize() { return true; }

  override onResize(shape: MultiplexerNodeShape, info: { scaleX: number; scaleY: number }) {
    return {
      props: {
        w: Math.max(300, shape.props.w * info.scaleX),
        h: Math.max(150, shape.props.h * info.scaleY),
      },
    };
  }
}

function MultiplexerComponent({ shape }: { shape: MultiplexerNodeShape }) {
  const { w, h, label, templateId, maxItems, inputDataJson } = shape.props;

  let rows: unknown[] = [];
  try {
    const parsed = JSON.parse(inputDataJson);
    rows = Array.isArray(parsed) ? parsed.slice(0, maxItems) : [];
  } catch { /* invalid */ }

  // Get template info
  let templateSvg = "";
  let templateName = templateId || "none";
  if (templateId) {
    try {
      const nt = getNodeType(templateId) as any;
      if (nt?.template_svg) {
        templateSvg = nt.template_svg;
        templateName = nt.name || templateId;
      }
    } catch { /* not found */ }
  }

  // Render each row through the template
  const renderedItems = rows.map((row, i) => {
    if (!templateSvg) return null;
    try {
      const data = typeof row === "object" && row !== null ? row : {};
      const rendered = renderTemplateInline(templateSvg, data as Record<string, unknown>);
      return rendered;
    } catch {
      return null;
    }
  });

  // Get available templates for the selector
  let availableTemplates: Array<{ id: string; name: string }> = [];
  try {
    availableTemplates = listNodeTypes().map(t => ({ id: t.id, name: t.name }));
  } catch { /* WASM not ready */ }

  const itemW = Math.max(100, (w - 20 - (Math.min(rows.length, maxItems) - 1) * 8) / Math.max(rows.length, 1));
  const itemH = h - 70;

  return (
    <HTMLContainer style={{ width: w, height: h, pointerEvents: "all" }}>
      <div style={{
        width: "100%", height: "100%",
        background: "#0f172a", border: "1px solid #475569",
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
          <span style={{ width: 6, height: 6, borderRadius: 2, background: "#ec4899" }} />
          <span>{label}</span>
          <span style={{ fontSize: 9, color: "#475569", marginLeft: "auto" }}>
            {rows.length}/{maxItems} items
          </span>
          <span style={{
            fontSize: 8, padding: "1px 4px", borderRadius: 3,
            background: "#ec4899", color: "#fff",
            textTransform: "uppercase",
          }}>
            ×{Math.min(rows.length, maxItems)}
          </span>
        </div>

        {/* Template selector */}
        <div style={{
          height: 28, padding: "0 8px",
          borderBottom: "1px solid #1e293b",
          display: "flex", alignItems: "center", gap: 4,
          fontSize: 10, color: "#64748b",
        }}>
          <span>Template:</span>
          <span style={{ color: templateId ? "#e2e8f0" : "#475569", fontWeight: 500 }}>
            {templateName}
          </span>
        </div>

        {/* Rendered items grid */}
        <div style={{
          flex: 1, padding: 8,
          display: "flex", gap: 8,
          overflow: "auto",
          alignItems: "flex-start",
        }}>
          {rows.length === 0 && (
            <div style={{
              width: "100%", height: "100%",
              display: "flex", alignItems: "center", justifyContent: "center",
              color: "#334155", fontSize: 12,
            }}>
              Connect a Table Node to see renders
            </div>
          )}
          {renderedItems.map((svg, i) => (
            <div key={i} style={{
              minWidth: itemW, maxWidth: itemW,
              height: itemH,
              background: "#0c1220",
              borderRadius: 6,
              border: "1px solid #1e293b",
              overflow: "hidden",
              flexShrink: 0,
            }}>
              {svg ? (
                <div
                  style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}
                  dangerouslySetInnerHTML={{
                    __html: `<svg width="100%" height="100%" preserveAspectRatio="xMidYMid meet">${extractInner(svg)}</svg>`
                  }}
                />
              ) : (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#334155", fontSize: 10 }}>
                  Row {i}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Input port (left) */}
        <Port side="left" color="#ec4899" shapeId={shape.id} />
      </div>
    </HTMLContainer>
  );
}

function extractInner(svg: string): string {
  const open = svg.match(/<svg[^>]*>/);
  if (!open) return svg;
  const start = open.index! + open[0].length;
  const end = svg.lastIndexOf("</svg>");
  return end === -1 ? svg.slice(start) : svg.slice(start, end);
}
