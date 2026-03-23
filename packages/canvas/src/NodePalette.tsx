/**
 * NodePalette — sidebar driven by the Runtime's node type registry.
 *
 * Groups nodes by subsystem (System, Data, View) with search, recently-used,
 * and collapsible sections. Settings modal preserved.
 */

import { useEditor } from "tldraw";
import { listNodeTypes, getNodeType as bridgeGetNodeType, renderTemplateInline } from "@svg-os/bridge";
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { getApiKey, setApiKey, getModel, setModel, testConnection } from "./lib/claude-api";
import { useRuntime } from "./RuntimeContext";
import { C, FONT } from "./theme";

// ── Node descriptions ─────────────────────────────────────────────────────────

const NODE_DESCRIPTIONS: Record<string, string> = {
  "sys:file-open": "Open a file from disk",
  "sys:file-write": "Save content to a file",
  "sys:folder": "Browse a directory",
  "sys:disk": "Storage usage info",
  "sys:processes": "Runtime metrics & memory",
  "sys:clipboard-read": "Read from clipboard",
  "sys:clipboard-write": "Write to clipboard",
  "sys:screen-capture": "Take a screenshot",
  "sys:notify": "Send a notification",
  "sys:network": "Network connection info",
  "sys:geolocation": "GPS location",
  "sys:terminal": "Code execution sandbox",
  "sys:notebook": "Multi-cell notebook",
  "sys:env": "Environment variables",
  "data:json": "Static JSON source",
  "data:table": "Tabular data editor",
  "data:transform": "Expression transform",
  "data:filter": "Filter an array",
  "data:merge": "Merge two objects",
  "data:fetch": "HTTP fetch",
  "data:ai": "Claude AI completion",
  "view:svg-template": "Rendered SVG template",
  "view:note": "Markdown editor",
  "view:webview": "Web browser iframe",
  "view:metric": "Single value display",
  "view:chart": "Data chart",
};

// ── Shape mapping ─────────────────────────────────────────────────────────────

const NODE_TO_SHAPE: Record<string, string> = {
  "sys:terminal": "terminal-node",
  "sys:notebook": "notebook-node",
  "data:json": "data-node",
  "data:table": "table-node",
  "data:transform": "transform-node",
  "data:ai": "ai-node",
  "view:note": "note-node",
  "view:svg-template": "view-node",
  "view:webview": "web-view",
};

// ── System sub-groups ─────────────────────────────────────────────────────────

const SYSTEM_GROUPS = [
  { label: "Files", types: ["sys:file-open", "sys:file-write", "sys:folder"] },
  { label: "Hardware", types: ["sys:disk", "sys:processes", "sys:network", "sys:geolocation"] },
  { label: "IO", types: ["sys:clipboard-read", "sys:clipboard-write", "sys:screen-capture", "sys:notify"] },
  { label: "Runtime", types: ["sys:terminal", "sys:notebook", "sys:env"] },
];

// ── Subsystem colors ──────────────────────────────────────────────────────────

function subsystemColor(type: string): string {
  if (type.startsWith("sys:")) return C.green;
  if (type.startsWith("data:")) return C.blue;
  if (type.startsWith("view:")) return C.accent;
  return C.muted;
}

// ── Default props per shape type ──────────────────────────────────────────────

function defaultPropsForShape(shapeType: string): Record<string, unknown> {
  switch (shapeType) {
    case "terminal-node":
      return {
        w: 400, h: 280, label: "Terminal", mode: "js",
        history: JSON.stringify([
          { type: "output", text: "SVG OS Terminal \u2014 JavaScript sandbox" },
          { type: "output", text: "Type expressions, see results. Try: 1 + 1" },
        ]),
      };
    case "notebook-node":
      return {
        w: 400, h: 320, label: "Notebook",
        cells: JSON.stringify([{ id: "c1", type: "code", lang: "python", source: "print('Hello!')\n2 ** 10", output: "" }]),
      };
    case "data-node":
      return { w: 300, h: 200, dataJson: '{\n  "name": "Example",\n  "score": 95\n}', label: "Data" };
    case "table-node":
      return { w: 320, h: 240, label: "Table", dataJson: "[]", selectedRow: -1, outputMode: "all" };
    case "transform-node":
      return { w: 180, h: 48, expression: "$.value", label: "Transform" };
    case "ai-node":
      return { w: 400, h: 320, label: "AI", prompt: "", response: "", model: getModel(), status: "idle", errorMessage: "" };
    case "note-node":
      return { w: 320, h: 240, label: "Note", content: "", mode: "edit" };
    case "web-view":
      return { w: 480, h: 360, url: "https://femiadeniran.com", label: "WebView" };
    default:
      return { w: 300, h: 200, label: "Node" };
  }
}

// ── Dummy data for pre-rendered SVG templates ─────────────────────────────────

const TEMPLATE_DUMMY_DATA: Record<string, Record<string, string>> = {
  "hero-card": {
    name: "KAEL STORMBRINGER", title: "Wind Elemental", element: "AIR",
    stars: "\u2605\u2605\u2605\u2605\u2605",
    atk: "92", def: "78", spd: "95", hp: "84",
    atk_width: "276", def_width: "234", spd_width: "285", hp_width: "252",
    color_a: "#6a9fcf", color_b: "#1a1815",
  },
  "profile-hud": {
    username: "SHADOWFOX", level: "47", status: "ONLINE",
    status_color: "#7eb59d", color_a: "#a78bca",
    xp_width: "210", xp_text: "2,450 / 3,000 XP",
    wins: "142", kd: "2.8", winrate: "68%",
    rank: "DIAMOND", rank_color: "#6a9fcf",
  },
  "pricing-card": {
    tier_name: "PRO", price: "$29", period: "/month",
    badge_text: "POPULAR", badge_color: "#e6a756",
    description: "Everything you need to scale",
    feature_1: "Unlimited projects", feature_2: "Priority support",
    feature_3: "Custom domains", feature_4: "Analytics dashboard",
    feature_5: "API access", cta: "Get Started", cta_color: "#7eb59d",
  },
  "team-member-card": {
    name: "Alex Chen", role: "Lead Engineer",
    location: "San Francisco, CA", accent_color: "#a78bca",
    quote: "Building the future,", quote_line2: "one commit at a time.",
  },
  "shader-card": {
    title: "PLASMA FIELD", subtitle: "Procedural Generation",
    pattern_label: "PLASMA", seed_info: "seed: 42",
    render_info: "512\u00d7512 @ 60fps", params_line: "octaves=6 gain=0.5",
  },
  "shader-poster": {
    title: "VOID NEBULA", subtitle: "Generative Art",
    pattern_label: "VORONOI", seed_info: "seed: 1337",
    render_info: "1024\u00d71024", params_line: "cells=64 jitter=0.8",
  },
  "scouting-report": {
    player_name: "Marcus Rivera", position: "Forward", team: "Thunder FC",
    rating: "8.7", pace: "91", shooting: "85", passing: "72",
    dribbling: "88", defending: "45", physical: "79",
    color_a: "#e6a756", color_b: "#1a1815",
  },
  "match-card": {
    home_team: "Thunder FC", away_team: "Storm United",
    home_score: "3", away_score: "1", venue: "Apex Arena",
    date: "2026-03-23", status: "FULL TIME",
    color_a: "#6a9fcf", color_b: "#cf7a9a",
  },
  "game-achievement": {
    title: "DRAGON SLAYER", description: "Defeat the Ancient Dragon",
    rarity: "LEGENDARY", xp: "+2,500 XP",
    color_a: "#e6a756", color_b: "#cf7a9a",
    progress: "1/1", badge: "\u2694",
  },
  "portfolio-card": {
    project_name: "SVG OS", category: "Creative Tools",
    description: "Infinite canvas computing environment",
    tech_1: "Rust", tech_2: "WASM", tech_3: "React",
    color_a: "#7eb59d", color_b: "#6a9fcf",
  },
  "brand-showcase": {
    brand_name: "AURORA", tagline: "Design without limits",
    color_a: "#a78bca", color_b: "#6a9fcf",
    stat_1: "10K+", stat_1_label: "Users",
    stat_2: "99.9%", stat_2_label: "Uptime",
    stat_3: "4.9", stat_3_label: "Rating",
  },
  "event-flyer": {
    event_name: "DESIGN CONF 2026", date: "MAR 28-30",
    venue: "The Apex Center, SF", tagline: "Where creativity meets code",
    speaker_1: "Sarah Kim", speaker_2: "Dev Patel",
    color_a: "#cf7a9a", color_b: "#e6a756",
  },
  "team-card": {
    team_name: "Thunder FC", league: "Premier Division",
    wins: "18", draws: "4", losses: "2", points: "58",
    color_a: "#6a9fcf", color_b: "#1a1815",
    captain: "M. Rivera", coach: "A. Torres",
  },
};

// ── Main Component ────────────────────────────────────────────────────────────

export function NodePalette() {
  const editor = useEditor();
  const runtime = useRuntime();
  const [search, setSearch] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [gridPickerOpen, setGridPickerOpen] = useState(false);
  const [recentlyUsed, setRecentlyUsed] = useState<string[]>([]);

  // Section collapse state
  const [sectionsOpen, setSectionsOpen] = useState<Record<string, boolean>>({
    system: true,
    data: true,
    view: true,
    templates: false,
  });

  const placementCount = useRef(0);
  const offset = () => {
    const i = placementCount.current++;
    return { x: (i % 4) * 250 - 375, y: Math.floor(i / 4) * 200 - 100 };
  };

  // Load recently used from localStorage
  useEffect(() => {
    try {
      const recent = JSON.parse(localStorage.getItem("svgos:recent-nodes") || "[]");
      setRecentlyUsed(recent.slice(0, 3));
    } catch { /* ignore */ }
  }, []);

  // ── SVG Templates from bridge ───────────────────────────────────────────

  const [svgTemplates, setSvgTemplates] = useState<Array<{ id: string; name: string }>>([]);

  useEffect(() => {
    const interval = setInterval(() => {
      try {
        const t = listNodeTypes();
        if (t.length > 0) {
          setSvgTemplates(t.map((x: any) => ({ id: x.id, name: x.name })));
          clearInterval(interval);
        }
      } catch { /* WASM not ready */ }
    }, 500);
    return () => clearInterval(interval);
  }, []);

  // ── Node types from runtime ─────────────────────────────────────────────

  const registeredTypes = useMemo(() => {
    if (!runtime) return new Set<string>();
    return new Set(runtime.listNodeDefs().map((d) => d.type));
  }, [runtime]);

  // ── Placement helpers ───────────────────────────────────────────────────

  const trackRecent = useCallback((nodeType: string) => {
    setRecentlyUsed((prev) => {
      const updated = [nodeType, ...prev.filter((r) => r !== nodeType)].slice(0, 3);
      try { localStorage.setItem("svgos:recent-nodes", JSON.stringify(updated)); } catch { /* ignore */ }
      return updated;
    });
  }, []);

  const placeNode = useCallback((nodeType: string) => {
    const shapeType = NODE_TO_SHAPE[nodeType];
    if (!shapeType) return;
    const o = offset();
    const center = editor.getViewportScreenCenter();
    const props = defaultPropsForShape(shapeType);
    const w = (props.w as number) || 300;
    const h = (props.h as number) || 200;
    editor.createShape({
      type: shapeType,
      x: center.x - w / 2 + o.x,
      y: center.y - h / 2 + o.y,
      props,
    });
    trackRecent(nodeType);
  }, [editor, trackRecent]);

  const placeSvgView = useCallback((typeId: string) => {
    const o = offset();
    try {
      const nt = bridgeGetNodeType(typeId) as {
        template_svg: string;
        default_width: number;
        default_height: number;
      };
      const maxSize = 280;
      const scale = Math.min(maxSize / nt.default_width, maxSize / nt.default_height, 1);
      const w = nt.default_width * scale;
      const h = nt.default_height * scale;
      const center = editor.getViewportScreenCenter();

      const dummyData = TEMPLATE_DUMMY_DATA[typeId] || {};
      let rendered = nt.template_svg;
      if (Object.keys(dummyData).length > 0) {
        try { rendered = renderTemplateInline(nt.template_svg, dummyData); } catch { /* fallback */ }
      }

      editor.createShape({
        type: "view-node",
        x: center.x - w / 2 + o.x,
        y: center.y - h / 2 + o.y,
        props: {
          w, h,
          viewType: "svg-template",
          typeId,
          renderedContent: rendered,
          variant: "", htmlTitle: "", htmlContent: "",
          data: JSON.stringify(dummyData),
        },
      });
      trackRecent(`tpl:${typeId}`);
    } catch (e) {
      console.error(`Failed to place ${typeId}:`, e);
    }
  }, [editor, trackRecent]);

  // ── Filter logic ────────────────────────────────────────────────────────

  const q = search.toLowerCase().trim();

  const matchesFilter = (nodeType: string, label?: string): boolean => {
    if (!q) return true;
    const desc = NODE_DESCRIPTIONS[nodeType] || "";
    const name = label || nodeType;
    return (
      name.toLowerCase().includes(q) ||
      desc.toLowerCase().includes(q) ||
      nodeType.toLowerCase().includes(q)
    );
  };

  const toggleSection = (key: string) =>
    setSectionsOpen((prev) => ({ ...prev, [key]: !prev[key] }));

  // Check if a node type has a shape (placeable)
  const isPlaceable = (nodeType: string): boolean => !!NODE_TO_SHAPE[nodeType];

  // ── Render helpers ──────────────────────────────────────────────────────

  const renderDot = (color: string) => (
    <span style={{
      width: 7, height: 7, borderRadius: "50%",
      background: color, flexShrink: 0,
    }} />
  );

  const renderItem = (
    nodeType: string,
    label: string,
    color: string,
    onClick: () => void,
    disabled?: boolean,
  ) => (
    <div
      key={nodeType}
      onClick={disabled ? undefined : onClick}
      title={NODE_DESCRIPTIONS[nodeType] || ""}
      style={{
        padding: "6px 10px",
        margin: "1px 0",
        borderRadius: 5,
        cursor: disabled ? "not-allowed" : "pointer",
        fontSize: 12,
        fontFamily: FONT.sans,
        color: disabled ? C.dim : C.fgSoft,
        display: "flex",
        alignItems: "center",
        gap: 8,
        opacity: disabled ? 0.4 : 1,
        transition: "background 0.12s ease",
        letterSpacing: "0.01em",
      }}
      onMouseEnter={(e) => {
        if (!disabled) e.currentTarget.style.background = C.bgHover;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
      }}
    >
      {renderDot(color)}
      <span style={{
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        fontWeight: 400,
      }}>
        {label}
      </span>
    </div>
  );

  // ── Build section content ───────────────────────────────────────────────

  // System section — sub-grouped
  const systemNodes = SYSTEM_GROUPS.map((group) => {
    const items = group.types.filter((t) => matchesFilter(t));
    if (items.length === 0) return null;
    return (
      <div key={group.label}>
        <div style={{
          fontFamily: FONT.mono, fontSize: 9, color: C.dim,
          textTransform: "uppercase", letterSpacing: "0.08em",
          padding: "8px 10px 4px",
        }}>
          {group.label}
        </div>
        {items.map((t) => {
          const placeable = isPlaceable(t);
          const label = t.split(":")[1]?.replace(/-/g, " ") || t;
          return renderItem(t, label, C.green, () => placeNode(t), !placeable);
        })}
      </div>
    );
  }).filter(Boolean);

  // Data section
  const dataTypes = ["data:json", "data:table", "data:transform", "data:filter", "data:merge", "data:fetch", "data:ai"];
  const dataNodes = dataTypes
    .filter((t) => matchesFilter(t))
    .map((t) => {
      const placeable = isPlaceable(t);
      const label = t.split(":")[1]?.replace(/-/g, " ") || t;
      return renderItem(t, label, C.blue, () => placeNode(t), !placeable);
    });

  // View section
  const viewTypes = ["view:note", "view:webview", "view:metric", "view:chart"];
  const viewNodes = viewTypes
    .filter((t) => matchesFilter(t))
    .map((t) => {
      const placeable = isPlaceable(t);
      const label = t.split(":")[1]?.replace(/-/g, " ") || t;
      return renderItem(t, label, C.accent, () => placeNode(t), !placeable);
    });

  // Templates section
  const templateNodes = svgTemplates
    .filter((t) => matchesFilter(`view:${t.id}`, t.name))
    .map((t) =>
      renderItem(`tpl:${t.id}`, t.name, C.cyan, () => placeSvgView(t.id)),
    );

  // Recently used
  const recentItems = recentlyUsed
    .filter((r) => matchesFilter(r))
    .map((r) => {
      if (r.startsWith("tpl:")) {
        const tid = r.slice(4);
        const tpl = svgTemplates.find((t) => t.id === tid);
        if (!tpl) return null;
        return renderItem(r, tpl.name, C.cyan, () => placeSvgView(tid));
      }
      const label = r.split(":")[1]?.replace(/-/g, " ") || r;
      const color = subsystemColor(r);
      const placeable = isPlaceable(r);
      return renderItem(r, label, color, () => placeNode(r), !placeable);
    })
    .filter(Boolean);

  const hasSystem = systemNodes.length > 0;
  const hasData = dataNodes.length > 0;
  const hasView = viewNodes.length > 0;
  const hasTemplates = templateNodes.length > 0;
  const hasRecent = recentItems.length > 0;

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <>
      <div style={{
        position: "absolute",
        left: 0, top: 0, bottom: 0,
        width: 180,
        background: C.bg,
        borderRight: `1px solid ${C.border}`,
        overflowY: "auto",
        zIndex: 1000,
        pointerEvents: "all",
        fontFamily: FONT.sans,
        display: "flex",
        flexDirection: "column",
      }}>
        {/* Header */}
        <div style={{
          padding: "14px 16px",
          borderBottom: `1px solid ${C.border}`,
        }}>
          <div style={{
            fontFamily: FONT.mono,
            fontSize: 10,
            fontWeight: 500,
            color: C.accent,
            textTransform: "uppercase",
            letterSpacing: "0.15em",
          }}>
            SVG OS
          </div>
        </div>

        {/* Search bar */}
        <div style={{
          padding: "8px 10px",
          borderBottom: `1px solid ${C.borderSoft}`,
        }}>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter nodes..."
            style={{
              width: "100%",
              padding: "6px 8px",
              background: C.bgDeep,
              border: `1px solid ${C.border}`,
              borderRadius: 5,
              color: C.fg,
              fontSize: 11,
              fontFamily: FONT.sans,
              outline: "none",
              letterSpacing: "0.01em",
              transition: "border-color 0.15s ease",
            }}
            onFocus={(e) => { e.currentTarget.style.borderColor = C.accent; }}
            onBlur={(e) => { e.currentTarget.style.borderColor = C.border; }}
          />
        </div>

        {/* Node sections */}
        <div style={{ padding: "6px 4px", flex: 1, overflowY: "auto" }}>

          {/* Core primitives — always visible */}
          <SectionHeader text="Primitives" />
          {renderItem("view:note", "Note", C.accent, () => placeNode("view:note"))}
          <div style={{ position: "relative" }}>
            {renderItem("data:table", "Table", C.blue, () => setGridPickerOpen(!gridPickerOpen))}
            {gridPickerOpen && (
              <GridPicker onSelect={(cols, rows) => {
                setGridPickerOpen(false);
                const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
                const colNames = Array.from({ length: cols }, (_, i) => letters[i] || `col${i + 1}`);
                const emptyRows = Array.from({ length: rows }, () => {
                  const r: Record<string, string> = {};
                  colNames.forEach(c => r[c] = "");
                  return r;
                });
                const o = offset();
                const center = editor.getViewportScreenCenter();
                const w = Math.max(200, cols * 80 + 50);
                const h = Math.max(120, rows * 28 + 60);
                editor.createShape({
                  type: "table-node",
                  x: center.x - w / 2 + o.x,
                  y: center.y - h / 2 + o.y,
                  props: { w, h, label: "Table", dataJson: JSON.stringify(emptyRows), selectedRow: -1, outputMode: "all" },
                });
                trackRecent("data:table");
              }} onClose={() => setGridPickerOpen(false)} />
            )}
          </div>
          {[
            { type: "sys:terminal", label: "Terminal", color: C.green },
            { type: "data:json", label: "Data", color: C.green },
            { type: "sys:notebook", label: "Notebook", color: C.purple },
            { type: "view:webview", label: "WebView", color: C.cyan },
            { type: "data:ai", label: "AI", color: C.blue },
            { type: "data:transform", label: "Transform", color: C.purple },
          ]
            .filter(p => matchesFilter(p.type, p.label))
            .map(p => renderItem(p.type, p.label, p.color, () => placeNode(p.type), !isPlaceable(p.type)))}

          {/* Templates */}
          {/* Templates removed — will improve later */}
        </div>

        {/* Settings button */}
        <div style={{
          padding: "10px 12px",
          borderTop: `1px solid ${C.border}`,
        }}>
          <button
            onClick={() => setSettingsOpen(true)}
            style={{
              width: "100%",
              padding: "7px 0",
              background: "transparent",
              border: `1px solid ${C.border}`,
              borderRadius: 6,
              color: C.faint,
              fontSize: 11,
              fontFamily: FONT.sans,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              letterSpacing: "0.02em",
              transition: "all 0.15s ease",
            }}
            onMouseEnter={e => {
              e.currentTarget.style.borderColor = C.accent;
              e.currentTarget.style.color = C.accent;
            }}
            onMouseLeave={e => {
              e.currentTarget.style.borderColor = C.border;
              e.currentTarget.style.color = C.faint;
            }}
          >
            <span style={{ fontSize: 13 }}>&#x2699;</span> Settings
          </button>
        </div>
      </div>

      {settingsOpen && (
        <SettingsModal onClose={() => setSettingsOpen(false)} />
      )}
    </>
  );
}

// ── SectionHeader (non-collapsible) ───────────────────────────────────────────

function SectionHeader({ text }: { text: string }) {
  return (
    <div style={{
      fontFamily: FONT.mono,
      fontSize: 9,
      fontWeight: 500,
      color: C.faint,
      textTransform: "uppercase",
      letterSpacing: "0.1em",
      padding: "10px 10px 4px",
    }}>
      {text}
    </div>
  );
}

// ── CollapsibleHeader ─────────────────────────────────────────────────────────

function CollapsibleHeader({
  text,
  open,
  onToggle,
  dotColor,
}: {
  text: string;
  open: boolean;
  onToggle: () => void;
  dotColor: string;
}) {
  return (
    <div
      onClick={onToggle}
      style={{
        fontFamily: FONT.mono,
        fontSize: 9,
        fontWeight: 500,
        color: C.faint,
        textTransform: "uppercase",
        letterSpacing: "0.1em",
        padding: "12px 10px 4px",
        cursor: "pointer",
        userSelect: "none",
        display: "flex",
        alignItems: "center",
        gap: 6,
      }}
    >
      <span style={{
        width: 6, height: 6, borderRadius: "50%",
        background: dotColor, flexShrink: 0, opacity: 0.7,
      }} />
      <span>{open ? "\u25BC" : "\u25B6"} {text}</span>
    </div>
  );
}

// ── Settings Modal ────────────────────────────────────────────────────────────

// ── Grid Picker (table dimension selector) ───────────────────────────────────

function GridPicker({ onSelect, onClose }: {
  onSelect: (cols: number, rows: number) => void;
  onClose: () => void;
}) {
  const [hoverCol, setHoverCol] = useState(0);
  const [hoverRow, setHoverRow] = useState(0);
  const maxCols = 6;
  const maxRows = 6;
  const cellSize = 18;
  const gap = 2;

  return (
    <div style={{
      position: "absolute", left: "100%", top: 0, marginLeft: 4,
      background: C.bgCard, border: `1px solid ${C.border}`,
      borderRadius: 8, padding: 10, zIndex: 100,
      boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
      pointerEvents: "all",
    }}
      onPointerDown={e => e.stopPropagation()}
    >
      <div style={{
        fontFamily: FONT.mono, fontSize: 10, color: C.accent,
        textAlign: "center", marginBottom: 6, letterSpacing: "0.05em",
      }}>
        {hoverCol > 0 ? `${hoverCol} × ${hoverRow}` : "Pick size"}
      </div>
      <div style={{
        display: "grid",
        gridTemplateColumns: `repeat(${maxCols}, ${cellSize}px)`,
        gap,
      }}>
        {Array.from({ length: maxRows * maxCols }, (_, i) => {
          const col = (i % maxCols) + 1;
          const row = Math.floor(i / maxCols) + 1;
          const active = col <= hoverCol && row <= hoverRow;
          return (
            <div key={i}
              onMouseEnter={() => { setHoverCol(col); setHoverRow(row); }}
              onClick={e => { e.stopPropagation(); onSelect(col, row); }}
              style={{
                width: cellSize, height: cellSize,
                borderRadius: 2,
                background: active ? C.blue : C.bgDeep,
                border: `1px solid ${active ? C.blue + "88" : C.border}`,
                cursor: "pointer",
                transition: "background 0.08s",
              }}
            />
          );
        })}
      </div>
      <div style={{
        marginTop: 6, textAlign: "center",
        fontSize: 9, color: C.dim,
      }}>
        <span onClick={e => { e.stopPropagation(); onClose(); }}
          style={{ cursor: "pointer", color: C.faint }}>cancel</span>
      </div>
    </div>
  );
}

// ── Settings Modal ───────────────────────────────────────────────────────────

function SettingsModal({ onClose }: { onClose: () => void }) {
  const [apiKey, setApiKeyLocal] = useState(getApiKey());
  const [model, setModelLocal] = useState(getModel());
  const [testStatus, setTestStatus] = useState<"idle" | "testing" | "ok" | "error">("idle");
  const [testError, setTestError] = useState("");

  const save = () => {
    setApiKey(apiKey);
    setModel(model);
  };

  const test = async () => {
    save();
    setTestStatus("testing");
    const { ok, error } = await testConnection();
    setTestStatus(ok ? "ok" : "error");
    setTestError(error || "");
  };

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        background: "rgba(10, 9, 7, 0.7)",
        backdropFilter: "blur(4px)",
        zIndex: 2000,
        pointerEvents: "all",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 400,
          background: C.bgCard,
          border: `1px solid ${C.border}`,
          borderRadius: 12,
          padding: 28,
          fontFamily: FONT.sans,
          color: C.fg,
          boxShadow: "0 16px 48px rgba(0,0,0,0.4)",
        }}
      >
        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          marginBottom: 24,
        }}>
          <div>
            <div style={{
              fontFamily: FONT.mono,
              fontSize: 9,
              textTransform: "uppercase",
              letterSpacing: "0.15em",
              color: C.accent,
              marginBottom: 4,
            }}>
              Configuration
            </div>
            <h2 style={{
              margin: 0,
              fontFamily: FONT.serif,
              fontSize: 20,
              fontWeight: 400,
              color: C.fg,
              letterSpacing: "-0.01em",
            }}>
              Settings
            </h2>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "transparent", border: "none",
              color: C.faint, fontSize: 18, cursor: "pointer",
            }}
          >
            &#x2715;
          </button>
        </div>

        {/* API Key */}
        <div style={{ marginBottom: 20 }}>
          <label style={{
            fontFamily: FONT.mono,
            fontSize: 10,
            color: C.muted,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            display: "block",
            marginBottom: 6,
          }}>
            Claude API Key
          </label>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKeyLocal(e.target.value)}
            onBlur={save}
            placeholder="sk-ant-..."
            style={{
              width: "100%", padding: "10px 12px",
              background: C.bgDeep,
              border: `1px solid ${C.border}`,
              borderRadius: 6,
              color: C.fg, fontSize: 13,
              outline: "none",
              fontFamily: FONT.mono,
              letterSpacing: "0.02em",
              transition: "border-color 0.15s ease",
            }}
            onFocus={e => e.currentTarget.style.borderColor = C.accent}
            onBlurCapture={e => e.currentTarget.style.borderColor = C.border}
          />
        </div>

        {/* Model */}
        <div style={{ marginBottom: 24 }}>
          <label style={{
            fontFamily: FONT.mono,
            fontSize: 10,
            color: C.muted,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            display: "block",
            marginBottom: 6,
          }}>
            Model
          </label>
          <select
            value={model}
            onChange={(e) => { setModelLocal(e.target.value); }}
            onBlur={save}
            style={{
              width: "100%", padding: "10px 12px",
              background: C.bgDeep,
              border: `1px solid ${C.border}`,
              borderRadius: 6,
              color: C.fg, fontSize: 13,
              outline: "none",
              fontFamily: FONT.sans,
            }}
          >
            <option value="claude-opus-4-6">Claude Opus 4.6</option>
            <option value="claude-sonnet-4-20250514">Claude Sonnet 4</option>
            <option value="claude-haiku-4-5-20251001">Claude Haiku 4.5</option>
          </select>
        </div>

        {/* Test */}
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <button
            onClick={test}
            disabled={testStatus === "testing"}
            style={{
              padding: "9px 20px",
              background: C.accent,
              border: "none",
              borderRadius: 6,
              color: C.bg,
              fontSize: 12,
              fontWeight: 600,
              fontFamily: FONT.sans,
              cursor: testStatus === "testing" ? "wait" : "pointer",
              letterSpacing: "0.02em",
              transition: "opacity 0.15s ease",
            }}
          >
            {testStatus === "testing" ? "Testing..." : "Test Connection"}
          </button>
          {testStatus === "ok" && (
            <span style={{ color: C.green, fontSize: 12, fontFamily: FONT.mono }}>
              Connected
            </span>
          )}
          {testStatus === "error" && (
            <span style={{ color: C.red, fontSize: 11, fontFamily: FONT.mono }}>
              {testError}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
