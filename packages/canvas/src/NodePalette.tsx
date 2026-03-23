/**
 * Node Palette — sidebar with 3 sections: DATA, TRANSFORM, VIEWS.
 * Click to place the corresponding shape primitive on the canvas.
 */

import { useEditor } from "tldraw";
import { listNodeTypes, getNodeType } from "@svg-os/bridge";
import { useState, useEffect, useCallback, useRef } from "react";

interface NodeTypeInfo {
  id: string;
  name: string;
  category: string;
  slots: Array<{ field: string; bind_type: string; target_attr: string }>;
  default_width: number;
  default_height: number;
}

// ── HTML view definitions ─────────────────────────────────────────────────────

const HTML_VIEWS = [
  {
    id: "html-dashboard",
    name: "Dashboard",
    variant: "dashboard",
    w: 220,
    h: 160,
    title: "System Monitor",
    content: "CPU: 42%,Memory: 68%,Disk: 23%,Network: 1.2GB/s",
  },
  {
    id: "html-table",
    name: "Data Table",
    variant: "table",
    w: 200,
    h: 150,
    title: "Data Table",
    content:
      "Name,Status,Score\nAlice,Active,95\nBob,Idle,82\nCarol,Active,91",
  },
  {
    id: "html-terminal",
    name: "Terminal",
    variant: "terminal",
    w: 220,
    h: 150,
    title: "Terminal",
    content: "",
  },
  {
    id: "html-metric",
    name: "Metric",
    variant: "metric",
    w: 140,
    h: 90,
    title: "Total Users",
    content: "1,247",
  },
  {
    id: "html-markdown",
    name: "Markdown",
    variant: "markdown",
    w: 200,
    h: 160,
    title: "Notes",
    content: "",
  },
];

// ── Section accent colors ────────────────────────────────────────────────────

const SECTION_COLORS: Record<string, string> = {
  data: "#22c55e",
  transform: "#8b5cf6",
  views: "#06b6d4",
  web: "#f97316",
  compute: "#22c55e",
};

export function NodePalette() {
  const editor = useEditor();
  const [svgTemplates, setSvgTemplates] = useState<NodeTypeInfo[]>([]);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({ views: true });

  useEffect(() => {
    const interval = setInterval(() => {
      try {
        const t = listNodeTypes();
        if (t.length > 0) {
          setSvgTemplates(t);
          clearInterval(interval);
        }
      } catch {
        /* WASM not ready yet */
      }
    }, 500);
    return () => clearInterval(interval);
  }, []);

  // ── Place handlers ─────────────────────────────────────────────────────────

  // Spread nodes horizontally — each new node goes further right
  const placementCount = useRef(0);
  const offset = () => {
    const i = placementCount.current++;
    return {
      x: (i % 4) * 250 - 375,  // spread across 1000px
      y: Math.floor(i / 4) * 200 - 100,
    };
  };

  const placeDataNode = useCallback(() => {
    const o = offset();
    const center = editor.getViewportScreenCenter();
    editor.createShape({
      type: "data-node",
      x: center.x - 80 + o.x,
      y: center.y - 24 + o.y,
      props: {
        w: 160,
        h: 48,
        dataJson: '{"name": "Example", "score": 95}',
        label: "Data",
      },
    });
  }, [editor]);

  const placeTransformNode = useCallback(() => {
    const o = offset();
    const center = editor.getViewportScreenCenter();
    editor.createShape({
      type: "transform-node",
      x: center.x - 90 + o.x,
      y: center.y - 24 + o.y,
      props: {
        w: 180,
        h: 48,
        expression: "$.value",
        label: "Transform",
      },
    });
  }, [editor]);

  const placeTableNode = useCallback(() => {
    const o = offset();
    const center = editor.getViewportScreenCenter();
    editor.createShape({
      type: "table-node",
      x: center.x - 160 + o.x,
      y: center.y - 120 + o.y,
      props: {
        w: 320, h: 240,
        label: "Table",
        dataJson: "[]",
        selectedRow: -1,
        outputMode: "all",
      },
    });
  }, [editor]);

  const placeMultiplexerNode = useCallback(() => {
    const o = offset();
    const center = editor.getViewportScreenCenter();
    editor.createShape({
      type: "multiplexer-node",
      x: center.x - 300 + o.x,
      y: center.y - 150 + o.y,
      props: {
        w: 600, h: 300,
        label: "Multiplexer",
        templateId: "",
        maxItems: 5,
        inputDataJson: "[]",
      },
    });
  }, [editor]);

  const placeSvgView = useCallback(
    (typeId: string) => {
      const o = offset();
      try {
        const nt = getNodeType(typeId) as {
          template_svg: string;
          default_width: number;
          default_height: number;
        };
        const maxSize = 200;
        const scale = Math.min(
          maxSize / nt.default_width,
          maxSize / nt.default_height,
          1
        );
        const w = nt.default_width * scale;
        const h = nt.default_height * scale;
        const center = editor.getViewportScreenCenter();

        editor.createShape({
          type: "view-node",
          x: center.x - w / 2 + o.x,
          y: center.y - h / 2 + o.y,
          props: {
            w,
            h,
            viewType: "svg-template",
            typeId,
            renderedContent: nt.template_svg,
            variant: "",
            htmlTitle: "",
            htmlContent: "",
            data: "",
          },
        });
      } catch (e) {
        console.error(`Failed to place SVG view ${typeId}:`, e);
      }
    },
    [editor]
  );

  const placeHtmlView = useCallback(
    (htmlDef: (typeof HTML_VIEWS)[number]) => {
      const o = offset();
      const center = editor.getViewportScreenCenter();
      editor.createShape({
        type: "view-node",
        x: center.x - htmlDef.w / 2 + o.x,
        y: center.y - htmlDef.h / 2 + o.y,
        props: {
          w: htmlDef.w,
          h: htmlDef.h,
          viewType: `html-${htmlDef.variant}`,
          typeId: "",
          renderedContent: "",
          variant: htmlDef.variant,
          htmlTitle: htmlDef.title,
          htmlContent: htmlDef.content,
          data: "",
        },
      });
    },
    [editor]
  );

  const placeTerminal = useCallback(() => {
    const o = offset();
    const center = editor.getViewportScreenCenter();
    editor.createShape({
      type: "terminal-node",
      x: center.x - 200 + o.x,
      y: center.y - 140 + o.y,
      props: { w: 400, h: 280, label: "Terminal", mode: "js",
        history: JSON.stringify([
          { type: "output", text: "SVG OS Terminal — JavaScript sandbox" },
          { type: "output", text: "Type expressions, see results. Try: 1 + 1" },
        ]),
      },
    });
  }, [editor]);

  const placeWebView = useCallback(() => {
    const o = offset();
    const center = editor.getViewportScreenCenter();
    editor.createShape({
      type: "web-view",
      x: center.x - 240 + o.x,
      y: center.y - 180 + o.y,
      props: {
        w: 480,
        h: 360,
        url: "https://example.com",
        label: "WebView",
      },
    });
  }, [editor]);

  const toggleCategory = (cat: string) => {
    setCollapsed((prev) => ({ ...prev, [cat]: !prev[cat] }));
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        bottom: 0,
        width: 200,
        background: "#151d2e",
        borderRight: "1px solid #334155",
        overflowY: "auto",
        zIndex: 1000,
        pointerEvents: "all",
        fontFamily: "Inter, system-ui, sans-serif",
      }}
    >
      <div
        style={{
          padding: "10px 12px",
          fontSize: 11,
          fontWeight: 600,
          color: "#94a3b8",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          borderBottom: "1px solid #334155",
        }}
      >
        Node Types
      </div>

      {/* ── DATA ─────────────────────────────────────────────────────── */}
      <SectionHeader
        label="Data"
        color={SECTION_COLORS.data}
        collapsed={!!collapsed.data}
        onToggle={() => toggleCategory("data")}
      />
      {!collapsed.data && (
        <div style={{ padding: "0 4px 4px" }}>
          <PaletteItem
            icon="📦"
            label="Static JSON"
            accent={SECTION_COLORS.data}
            onClick={placeDataNode}
          />
          <PaletteItem
            icon="📊"
            label="Table"
            accent="#3b82f6"
            onClick={placeTableNode}
          />
          <PaletteItem
            icon="⊞"
            label="Multi View"
            accent="#ec4899"
            onClick={placeMultiplexerNode}
          />
        </div>
      )}

      {/* ── TRANSFORM ────────────────────────────────────────────────── */}
      <SectionHeader
        label="Transform"
        color={SECTION_COLORS.transform}
        collapsed={!!collapsed.transform}
        onToggle={() => toggleCategory("transform")}
      />
      {!collapsed.transform && (
        <div style={{ padding: "0 4px 4px" }}>
          <PaletteItem
            icon="⚡"
            label="Expression"
            accent={SECTION_COLORS.transform}
            onClick={placeTransformNode}
          />
        </div>
      )}

      {/* ── VIEWS ────────────────────────────────────────────────────── */}
      <SectionHeader
        label="Views"
        color={SECTION_COLORS.views}
        collapsed={!!collapsed.views}
        onToggle={() => toggleCategory("views")}
      />
      {!collapsed.views && (
        <div style={{ padding: "0 4px 4px" }}>
          {svgTemplates.length === 0 && (
            <div
              style={{
                padding: "4px 8px",
                color: "#475569",
                fontSize: 11,
              }}
            >
              Loading templates...
            </div>
          )}
          {svgTemplates.map((t) => (
            <PaletteItem
              key={t.id}
              label={t.name}
              accent={SECTION_COLORS.views}
              onClick={() => placeSvgView(t.id)}
            />
          ))}
          {/* HTML views */}
          {HTML_VIEWS.map((hv) => (
            <PaletteItem
              key={hv.id}
              label={hv.name}
              accent="#f59e0b"
              onClick={() => placeHtmlView(hv)}
            />
          ))}
        </div>
      )}

      {/* ── COMPUTE ───────────────────────────────────────────────────── */}
      <SectionHeader
        label="Compute"
        color={SECTION_COLORS.compute}
        collapsed={!!collapsed.compute}
        onToggle={() => toggleCategory("compute")}
      />
      {!collapsed.compute && (
        <div style={{ padding: "0 4px 4px" }}>
          <PaletteItem
            icon="▶"
            label="Terminal"
            accent={SECTION_COLORS.compute}
            onClick={placeTerminal}
          />
        </div>
      )}

      {/* ── WEB ──────────────────────────────────────────────────────── */}
      <SectionHeader
        label="Web"
        color={SECTION_COLORS.web}
        collapsed={!!collapsed.web}
        onToggle={() => toggleCategory("web")}
      />
      {!collapsed.web && (
        <div style={{ padding: "0 4px 4px" }}>
          <PaletteItem
            icon="🌐"
            label="WebView"
            accent={SECTION_COLORS.web}
            onClick={placeWebView}
          />
        </div>
      )}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SectionHeader({
  label,
  color,
  collapsed,
  onToggle,
}: {
  label: string;
  color: string;
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <div
      onClick={onToggle}
      style={{
        padding: "6px 12px",
        fontSize: 10,
        fontWeight: 600,
        color: "#64748b",
        textTransform: "uppercase",
        letterSpacing: "0.08em",
        cursor: "pointer",
        userSelect: "none",
        borderBottom: "1px solid #1e293b",
        display: "flex",
        alignItems: "center",
        gap: 6,
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: color,
          flexShrink: 0,
        }}
      />
      {collapsed ? "\u25B6" : "\u25BC"} {label}
    </div>
  );
}

function PaletteItem({
  icon,
  label,
  sublabel,
  accent,
  onClick,
}: {
  icon?: string;
  label: string;
  sublabel?: string;
  accent: string;
  onClick: () => void;
}) {
  return (
    <div
      onClick={onClick}
      style={{
        padding: "4px 8px",
        margin: "1px 0",
        borderRadius: 4,
        cursor: "pointer",
        fontSize: 12,
        color: "#cbd5e1",
        display: "flex",
        alignItems: "center",
        gap: 6,
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "#1e293b")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      {icon ? (
        <span style={{ fontSize: 12, flexShrink: 0, width: 16, textAlign: "center" }}>
          {icon}
        </span>
      ) : (
        <span
          style={{
            width: 16,
            height: 16,
            borderRadius: 3,
            background: "#334155",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 9,
            flexShrink: 0,
            color: accent,
            fontWeight: 700,
          }}
        >
          {label.charAt(0).toUpperCase()}
        </span>
      )}
      <span
        style={{
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </span>
      {sublabel && (
        <span
          style={{
            marginLeft: "auto",
            fontSize: 9,
            color: "#475569",
            flexShrink: 0,
            textTransform: "uppercase",
          }}
        >
          {sublabel}
        </span>
      )}
    </div>
  );
}
