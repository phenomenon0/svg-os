/**
 * HtmlShape — renders arbitrary HTML content as a tldraw shape.
 *
 * Proves that SVG OS canvas isn't limited to SVG. Any browser-renderable
 * content works: tables, charts, styled divs, iframes, video, forms.
 */

import { HTMLContainer, Rectangle2d, ShapeUtil, T, TLBaseShape, Vec } from "tldraw";

export type HtmlShape = TLBaseShape<
  "html",
  {
    w: number;
    h: number;
    variant: string;
    title: string;
    content: string;
  }
>;

export class HtmlShapeUtil extends ShapeUtil<HtmlShape> {
  static override type = "html" as const;

  static override props = {
    w: T.number,
    h: T.number,
    variant: T.string,
    title: T.string,
    content: T.string,
  };

  getDefaultProps(): HtmlShape["props"] {
    return {
      w: 280,
      h: 200,
      variant: "card",
      title: "HTML Node",
      content: "",
    };
  }

  override getGeometry(shape: HtmlShape) {
    return new Rectangle2d({
      width: shape.props.w,
      height: shape.props.h,
      isFilled: true,
    });
  }

  override canBind() { return true; }

  override getHandleSnapGeometry(shape: HtmlShape) {
    return {
      points: [
        new Vec(0, shape.props.h / 2),
        new Vec(shape.props.w, shape.props.h / 2),
      ],
    };
  }

  override component(shape: HtmlShape) {
    const { w, h, variant, title, content } = shape.props;

    const variantColors: Record<string, string> = {
      dashboard: "#22c55e", table: "#3b82f6", terminal: "#a855f7",
      metric: "#f59e0b", markdown: "#06b6d4", card: "#64748b",
    };
    const accent = variantColors[variant] || "#64748b";

    return (
      <HTMLContainer
        style={{ width: w, height: h, overflow: "hidden", borderRadius: 8, pointerEvents: "all", position: "relative" }}
      >
        {variant === "dashboard" && <DashboardCard w={w} h={h} title={title} content={content} />}
        {variant === "table" && <TableCard w={w} h={h} title={title} content={content} />}
        {variant === "terminal" && <TerminalCard w={w} h={h} title={title} content={content} />}
        {variant === "metric" && <MetricCard w={w} h={h} title={title} content={content} />}
        {variant === "markdown" && <MarkdownCard w={w} h={h} title={title} content={content} />}
        {variant === "card" && <GenericCard w={w} h={h} title={title} content={content} />}

        {/* Input port */}
        <div style={{
          position: "absolute", left: -6, top: "50%", transform: "translateY(-50%)",
          width: 12, height: 12, borderRadius: "50%",
          background: "#06b6d4", border: "2px solid #0f172a",
          cursor: "crosshair", zIndex: 10,
        }} />

        {/* Output port */}
        <div style={{
          position: "absolute", right: -6, top: "50%", transform: "translateY(-50%)",
          width: 12, height: 12, borderRadius: "50%",
          background: accent, border: "2px solid #0f172a",
          cursor: "crosshair", zIndex: 10,
        }} />

        {/* Status bar */}
        <div style={{
          position: "absolute", bottom: 0, left: 0, right: 0,
          height: 20, padding: "0 8px",
          background: "rgba(0,0,0,0.4)", backdropFilter: "blur(4px)",
          display: "flex", alignItems: "center", gap: 6,
          fontSize: 9, color: "#64748b",
        }}>
          <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#22c55e" }} />
          <span>Live</span>
          <span style={{ marginLeft: "auto", textTransform: "uppercase", letterSpacing: "0.05em" }}>{variant}</span>
        </div>
      </HTMLContainer>
    );
  }

  override indicator(shape: HtmlShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={8} />;
  }

  override canResize() {
    return true;
  }

  override onResize(shape: HtmlShape, info: { scaleX: number; scaleY: number }) {
    return {
      props: {
        w: Math.max(120, shape.props.w * info.scaleX),
        h: Math.max(80, shape.props.h * info.scaleY),
      },
    };
  }
}

// ── HTML Card Variants ─────────────────────────────────────────────────────

const baseStyle: React.CSSProperties = {
  fontFamily: "'Inter', system-ui, sans-serif",
  color: "#e2e8f0",
  height: "100%",
  display: "flex",
  flexDirection: "column",
};

function DashboardCard({ w, h, title, content }: { w: number; h: number; title: string; content: string }) {
  const items = content ? content.split(",").map(s => s.trim()) : ["CPU: 42%", "Memory: 68%", "Disk: 23%", "Network: 1.2GB/s"];
  return (
    <div style={{ ...baseStyle, background: "linear-gradient(135deg, #1e293b, #0f172a)", border: "1px solid #334155" }}>
      <div style={{ padding: "10px 14px", borderBottom: "1px solid #334155", fontSize: 12, fontWeight: 600, color: "#94a3b8", display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#22c55e" }} />
        {title || "System Monitor"}
      </div>
      <div style={{ flex: 1, padding: 12, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        {items.map((item, i) => {
          const [label, value] = item.includes(":") ? item.split(":").map(s => s.trim()) : [item, "—"];
          const pct = parseInt(value) || 0;
          return (
            <div key={i} style={{ background: "#0f172a", borderRadius: 6, padding: "8px 10px" }}>
              <div style={{ fontSize: 10, color: "#64748b", marginBottom: 4 }}>{label}</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: pct > 80 ? "#ef4444" : pct > 50 ? "#f59e0b" : "#22c55e" }}>{value}</div>
              <div style={{ height: 3, background: "#1e293b", borderRadius: 2, marginTop: 4 }}>
                <div style={{ height: "100%", width: `${Math.min(pct, 100)}%`, background: pct > 80 ? "#ef4444" : pct > 50 ? "#f59e0b" : "#22c55e", borderRadius: 2 }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TableCard({ w, h, title, content }: { w: number; h: number; title: string; content: string }) {
  const rows = content
    ? content.split("\n").map(r => r.split(",").map(c => c.trim()))
    : [["Name", "Status", "Score"], ["Alice", "Active", "95"], ["Bob", "Idle", "82"], ["Carol", "Active", "91"]];
  const header = rows[0] || [];
  const body = rows.slice(1);
  return (
    <div style={{ ...baseStyle, background: "#0f172a", border: "1px solid #334155" }}>
      <div style={{ padding: "8px 12px", borderBottom: "1px solid #334155", fontSize: 11, fontWeight: 600, color: "#94a3b8" }}>
        {title || "Data Table"}
      </div>
      <div style={{ flex: 1, overflow: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
          <thead>
            <tr>{header.map((h, i) => <th key={i} style={{ padding: "6px 10px", textAlign: "left", borderBottom: "1px solid #1e293b", color: "#64748b", fontWeight: 500 }}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {body.map((row, ri) => (
              <tr key={ri} style={{ background: ri % 2 === 0 ? "transparent" : "#0c1220" }}>
                {row.map((cell, ci) => <td key={ci} style={{ padding: "5px 10px", borderBottom: "1px solid #0f172a" }}>{cell}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TerminalCard({ w, h, title, content }: { w: number; h: number; title: string; content: string }) {
  const lines = content || "$ svg-os eval 'if($.score > 90, \"Excellent\", \"Good\")' data.json\nExcellent\n$ svg-os describe fixtures/templates/match-card.svg\n{ \"slots\": 12 }\n$ █";
  return (
    <div style={{ ...baseStyle, background: "#000000", border: "1px solid #333" }}>
      <div style={{ padding: "6px 12px", background: "#1a1a1a", borderBottom: "1px solid #333", fontSize: 11, display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#ef4444" }} />
        <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#f59e0b" }} />
        <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#22c55e" }} />
        <span style={{ flex: 1, textAlign: "center", color: "#666", fontSize: 10 }}>{title || "Terminal"}</span>
      </div>
      <pre style={{ flex: 1, margin: 0, padding: 10, fontSize: 11, fontFamily: "'JetBrains Mono', 'Fira Code', monospace", color: "#22c55e", overflow: "auto", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>
        {lines}
      </pre>
    </div>
  );
}

function MetricCard({ w, h, title, content }: { w: number; h: number; title: string; content: string }) {
  const value = content || "1,247";
  return (
    <div style={{ ...baseStyle, background: "linear-gradient(135deg, #1e3a5f, #0f172a)", border: "1px solid #2563eb33", alignItems: "center", justifyContent: "center", textAlign: "center" }}>
      <div style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 4 }}>{title || "Total Users"}</div>
      <div style={{ fontSize: Math.min(36, w / 5), fontWeight: 800, background: "linear-gradient(135deg, #3b82f6, #8b5cf6)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>{value}</div>
      <div style={{ fontSize: 10, color: "#22c55e", marginTop: 4 }}>↑ 12.5%</div>
    </div>
  );
}

function MarkdownCard({ w, h, title, content }: { w: number; h: number; title: string; content: string }) {
  const text = content || "## SVG OS\n\nA **programmable** visual document engine.\n\n- Expression engine (24 functions)\n- Data flow through connectors\n- MCP server (5 tools)\n- tldraw infinite canvas";
  // Simple markdown-ish rendering (not a full parser)
  const html = text
    .replace(/^## (.+)$/gm, '<h2 style="font-size:16px;margin:0 0 8px;color:#e2e8f0">$1</h2>')
    .replace(/^### (.+)$/gm, '<h3 style="font-size:13px;margin:0 0 6px;color:#cbd5e1">$1</h3>')
    .replace(/\*\*(.+?)\*\*/g, '<strong style="color:#f8fafc">$1</strong>')
    .replace(/^- (.+)$/gm, '<div style="padding-left:12px;margin:2px 0">• $1</div>')
    .replace(/\n\n/g, '<div style="height:8px"></div>')
    .replace(/\n/g, "<br>");
  return (
    <div style={{ ...baseStyle, background: "#0f172a", border: "1px solid #334155" }}>
      <div style={{ padding: "8px 12px", borderBottom: "1px solid #334155", fontSize: 11, fontWeight: 600, color: "#94a3b8" }}>
        {title || "Notes"}
      </div>
      <div style={{ flex: 1, padding: 12, fontSize: 12, lineHeight: 1.6, color: "#94a3b8", overflow: "auto" }} dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}

function GenericCard({ w, h, title, content }: { w: number; h: number; title: string; content: string }) {
  return (
    <div style={{ ...baseStyle, background: "#1e293b", border: "1px solid #334155" }}>
      <div style={{ padding: "10px 14px", borderBottom: "1px solid #334155", fontSize: 13, fontWeight: 600 }}>{title || "HTML Node"}</div>
      <div style={{ flex: 1, padding: 12, fontSize: 12, color: "#94a3b8" }}>{content || "This is a native HTML node. It renders divs, not SVG."}</div>
    </div>
  );
}
