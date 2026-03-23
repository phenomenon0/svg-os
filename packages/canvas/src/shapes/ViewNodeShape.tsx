/**
 * ViewNode — renders template content with NO wrapper chrome.
 * The template IS the node. Ports are tiny circles at the edge.
 *
 * For SVG templates: renders via dangerouslySetInnerHTML with proper viewBox.
 * For HTML views: renders the variant card directly (Dashboard, Table, etc.).
 * Input port on the left edge only. No output port.
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
    viewType: string;       // 'svg-template' | 'html-dashboard' | 'html-table' | etc.
    typeId: string;         // for SVG templates: the template ID
    renderedContent: string; // resolved SVG/HTML string
    variant: string;        // for HTML views: dashboard/table/terminal/metric/markdown
    htmlTitle: string;      // for HTML views
    htmlContent: string;    // for HTML views
    data: string;           // JSON data for template rendering (from param panel or upstream)
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
      w: 200,
      h: 150,
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
      points: [new Vec(0, shape.props.h / 2)], // input port left only
    };
  }

  override component(shape: ViewNodeShape) {
    const { w, h, viewType, renderedContent, variant, htmlTitle, htmlContent } = shape.props;

    const isSvg = viewType === "svg-template";

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
        {/* Input port */}
        <Port side="left" color="#06b6d4" shapeId={shape.id} />

        {isSvg ? (
          <SvgView w={w} h={h} content={renderedContent} />
        ) : (
          <HtmlView
            w={w}
            h={h}
            variant={variant}
            title={htmlTitle}
            content={htmlContent}
          />
        )}
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

// ── SVG View (no chrome) ──────────────────────────────────────────────────────

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

// ── HTML View (dispatches to variant cards) ───────────────────────────────────

function HtmlView({
  w,
  h,
  variant,
  title,
  content,
}: {
  w: number;
  h: number;
  variant: string;
  title: string;
  content: string;
}) {
  switch (variant) {
    case "dashboard":
      return <DashboardCard w={w} h={h} title={title} content={content} />;
    case "table":
      return <TableCard w={w} h={h} title={title} content={content} />;
    case "terminal":
      return <TerminalCard w={w} h={h} title={title} content={content} />;
    case "metric":
      return <MetricCard w={w} h={h} title={title} content={content} />;
    case "markdown":
      return <MarkdownCard w={w} h={h} title={title} content={content} />;
    default:
      return <GenericCard w={w} h={h} title={title} content={content} />;
  }
}

// ── HTML Card Variants ────────────────────────────────────────────────────────

const baseStyle: React.CSSProperties = {
  fontFamily: "'Inter', system-ui, sans-serif",
  color: "#e2e8f0",
  height: "100%",
  display: "flex",
  flexDirection: "column",
  borderRadius: 8,
  overflow: "hidden",
};

function DashboardCard({
  w,
  h,
  title,
  content,
}: {
  w: number;
  h: number;
  title: string;
  content: string;
}) {
  const items = content
    ? content.split(",").map((s) => s.trim())
    : ["CPU: 42%", "Memory: 68%", "Disk: 23%", "Network: 1.2GB/s"];
  return (
    <div
      style={{
        ...baseStyle,
        background: "linear-gradient(135deg, #1e293b, #0f172a)",
        border: "1px solid #334155",
      }}
    >
      <div
        style={{
          padding: "10px 14px",
          borderBottom: "1px solid #334155",
          fontSize: 12,
          fontWeight: 600,
          color: "#94a3b8",
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: "#22c55e",
          }}
        />
        {title || "System Monitor"}
      </div>
      <div
        style={{
          flex: 1,
          padding: 12,
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 8,
        }}
      >
        {items.map((item, i) => {
          const [label, value] = item.includes(":")
            ? item.split(":").map((s) => s.trim())
            : [item, "\u2014"];
          const pct = parseInt(value) || 0;
          return (
            <div
              key={i}
              style={{
                background: "#0f172a",
                borderRadius: 6,
                padding: "8px 10px",
              }}
            >
              <div style={{ fontSize: 10, color: "#64748b", marginBottom: 4 }}>
                {label}
              </div>
              <div
                style={{
                  fontSize: 16,
                  fontWeight: 700,
                  color:
                    pct > 80 ? "#ef4444" : pct > 50 ? "#f59e0b" : "#22c55e",
                }}
              >
                {value}
              </div>
              <div
                style={{
                  height: 3,
                  background: "#1e293b",
                  borderRadius: 2,
                  marginTop: 4,
                }}
              >
                <div
                  style={{
                    height: "100%",
                    width: `${Math.min(pct, 100)}%`,
                    background:
                      pct > 80
                        ? "#ef4444"
                        : pct > 50
                          ? "#f59e0b"
                          : "#22c55e",
                    borderRadius: 2,
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TableCard({
  w,
  h,
  title,
  content,
}: {
  w: number;
  h: number;
  title: string;
  content: string;
}) {
  const rows = content
    ? content.split("\n").map((r) => r.split(",").map((c) => c.trim()))
    : [
        ["Name", "Status", "Score"],
        ["Alice", "Active", "95"],
        ["Bob", "Idle", "82"],
        ["Carol", "Active", "91"],
      ];
  const header = rows[0] || [];
  const body = rows.slice(1);
  return (
    <div
      style={{
        ...baseStyle,
        background: "#0f172a",
        border: "1px solid #334155",
      }}
    >
      <div
        style={{
          padding: "8px 12px",
          borderBottom: "1px solid #334155",
          fontSize: 11,
          fontWeight: 600,
          color: "#94a3b8",
        }}
      >
        {title || "Data Table"}
      </div>
      <div style={{ flex: 1, overflow: "auto" }}>
        <table
          style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}
        >
          <thead>
            <tr>
              {header.map((hdr, i) => (
                <th
                  key={i}
                  style={{
                    padding: "6px 10px",
                    textAlign: "left",
                    borderBottom: "1px solid #1e293b",
                    color: "#64748b",
                    fontWeight: 500,
                  }}
                >
                  {hdr}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {body.map((row, ri) => (
              <tr
                key={ri}
                style={{
                  background: ri % 2 === 0 ? "transparent" : "#0c1220",
                }}
              >
                {row.map((cell, ci) => (
                  <td
                    key={ci}
                    style={{
                      padding: "5px 10px",
                      borderBottom: "1px solid #0f172a",
                    }}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TerminalCard({
  w,
  h,
  title,
  content,
}: {
  w: number;
  h: number;
  title: string;
  content: string;
}) {
  const lines =
    content ||
    '$ svg-os eval \'if($.score > 90, "Excellent", "Good")\' data.json\nExcellent\n$ svg-os describe fixtures/templates/match-card.svg\n{ "slots": 12 }\n$ \u2588';
  return (
    <div
      style={{ ...baseStyle, background: "#000000", border: "1px solid #333" }}
    >
      <div
        style={{
          padding: "6px 12px",
          background: "#1a1a1a",
          borderBottom: "1px solid #333",
          fontSize: 11,
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        <span
          style={{
            width: 10,
            height: 10,
            borderRadius: "50%",
            background: "#ef4444",
          }}
        />
        <span
          style={{
            width: 10,
            height: 10,
            borderRadius: "50%",
            background: "#f59e0b",
          }}
        />
        <span
          style={{
            width: 10,
            height: 10,
            borderRadius: "50%",
            background: "#22c55e",
          }}
        />
        <span
          style={{
            flex: 1,
            textAlign: "center",
            color: "#666",
            fontSize: 10,
          }}
        >
          {title || "Terminal"}
        </span>
      </div>
      <pre
        style={{
          flex: 1,
          margin: 0,
          padding: 10,
          fontSize: 11,
          fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
          color: "#22c55e",
          overflow: "auto",
          lineHeight: 1.5,
          whiteSpace: "pre-wrap",
        }}
      >
        {lines}
      </pre>
    </div>
  );
}

function MetricCard({
  w,
  h,
  title,
  content,
}: {
  w: number;
  h: number;
  title: string;
  content: string;
}) {
  const value = content || "1,247";
  return (
    <div
      style={{
        ...baseStyle,
        background: "linear-gradient(135deg, #1e3a5f, #0f172a)",
        border: "1px solid #2563eb33",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
      }}
    >
      <div
        style={{
          fontSize: 11,
          color: "#64748b",
          textTransform: "uppercase",
          letterSpacing: "0.1em",
          marginBottom: 4,
        }}
      >
        {title || "Total Users"}
      </div>
      <div
        style={{
          fontSize: Math.min(36, w / 5),
          fontWeight: 800,
          background: "linear-gradient(135deg, #3b82f6, #8b5cf6)",
          WebkitBackgroundClip: "text",
          WebkitTextFillColor: "transparent",
        }}
      >
        {value}
      </div>
      <div style={{ fontSize: 10, color: "#22c55e", marginTop: 4 }}>
        \u2191 12.5%
      </div>
    </div>
  );
}

function MarkdownCard({
  w,
  h,
  title,
  content,
}: {
  w: number;
  h: number;
  title: string;
  content: string;
}) {
  const text =
    content ||
    "## SVG OS\n\nA **programmable** visual document engine.\n\n- Expression engine (24 functions)\n- Data flow through connectors\n- MCP server (5 tools)\n- tldraw infinite canvas";
  const html = text
    .replace(
      /^## (.+)$/gm,
      '<h2 style="font-size:16px;margin:0 0 8px;color:#e2e8f0">$1</h2>'
    )
    .replace(
      /^### (.+)$/gm,
      '<h3 style="font-size:13px;margin:0 0 6px;color:#cbd5e1">$1</h3>'
    )
    .replace(
      /\*\*(.+?)\*\*/g,
      '<strong style="color:#f8fafc">$1</strong>'
    )
    .replace(
      /^- (.+)$/gm,
      '<div style="padding-left:12px;margin:2px 0">\u2022 $1</div>'
    )
    .replace(/\n\n/g, '<div style="height:8px"></div>')
    .replace(/\n/g, "<br>");
  return (
    <div
      style={{
        ...baseStyle,
        background: "#0f172a",
        border: "1px solid #334155",
      }}
    >
      <div
        style={{
          padding: "8px 12px",
          borderBottom: "1px solid #334155",
          fontSize: 11,
          fontWeight: 600,
          color: "#94a3b8",
        }}
      >
        {title || "Notes"}
      </div>
      <div
        style={{
          flex: 1,
          padding: 12,
          fontSize: 12,
          lineHeight: 1.6,
          color: "#94a3b8",
          overflow: "auto",
        }}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}

function GenericCard({
  w,
  h,
  title,
  content,
}: {
  w: number;
  h: number;
  title: string;
  content: string;
}) {
  return (
    <div
      style={{
        ...baseStyle,
        background: "#1e293b",
        border: "1px solid #334155",
      }}
    >
      <div
        style={{
          padding: "10px 14px",
          borderBottom: "1px solid #334155",
          fontSize: 13,
          fontWeight: 600,
        }}
      >
        {title || "View"}
      </div>
      <div style={{ flex: 1, padding: 12, fontSize: 12, color: "#94a3b8" }}>
        {content || "Connect a data source to populate this view."}
      </div>
    </div>
  );
}

// ── SVG Helpers ───────────────────────────────────────────────────────────────

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
