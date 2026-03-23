/**
 * Node Palette — sidebar with 7 strong primitives + 2 plumbing nodes.
 * Settings modal for Claude API key configuration.
 */

import { useEditor } from "tldraw";
import { listNodeTypes, getNodeType, renderTemplateInline } from "@svg-os/bridge";
import { useState, useEffect, useCallback, useRef } from "react";
import { getApiKey, setApiKey, getModel, setModel, testConnection } from "./lib/claude-api";
import { C, FONT } from "./theme";

interface NodeTypeInfo {
  id: string;
  name: string;
  category: string;
  slots: Array<{ field: string; bind_type: string; target_attr: string }>;
  default_width: number;
  default_height: number;
}

// ── Dummy data for pre-rendered templates ────────────────────────────────────

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

export function NodePalette() {
  const editor = useEditor();
  const [svgTemplates, setSvgTemplates] = useState<NodeTypeInfo[]>([]);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [plumbingOpen, setPlumbingOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => {
      try {
        const t = listNodeTypes();
        if (t.length > 0) {
          setSvgTemplates(t);
          clearInterval(interval);
        }
      } catch { /* WASM not ready */ }
    }, 500);
    return () => clearInterval(interval);
  }, []);

  // ── Placement ───────────────────────────────────────────────────────────────

  const placementCount = useRef(0);
  const offset = () => {
    const i = placementCount.current++;
    return {
      x: (i % 4) * 250 - 375,
      y: Math.floor(i / 4) * 200 - 100,
    };
  };

  const placeNote = useCallback(() => {
    const o = offset();
    const center = editor.getViewportScreenCenter();
    editor.createShape({
      type: "note-node",
      x: center.x - 160 + o.x,
      y: center.y - 120 + o.y,
      props: { w: 320, h: 240, label: "Note", content: "", mode: "edit" },
    });
  }, [editor]);

  const placeTable = useCallback(() => {
    const o = offset();
    const center = editor.getViewportScreenCenter();
    editor.createShape({
      type: "table-node",
      x: center.x - 160 + o.x,
      y: center.y - 120 + o.y,
      props: { w: 320, h: 240, label: "Table", dataJson: "[]", selectedRow: -1, outputMode: "all" },
    });
  }, [editor]);

  const placeNotebook = useCallback(() => {
    const o = offset();
    const center = editor.getViewportScreenCenter();
    editor.createShape({
      type: "notebook-node",
      x: center.x - 200 + o.x,
      y: center.y - 160 + o.y,
      props: {
        w: 400, h: 320, label: "Notebook",
        cells: JSON.stringify([{ id: "c1", type: "code", lang: "python", source: "print('Hello from Python!')\n2 ** 10", output: "" }]),
      },
    });
  }, [editor]);

  const placeTerminal = useCallback(() => {
    const o = offset();
    const center = editor.getViewportScreenCenter();
    editor.createShape({
      type: "terminal-node",
      x: center.x - 200 + o.x,
      y: center.y - 140 + o.y,
      props: {
        w: 400, h: 280, label: "Terminal", mode: "js",
        history: JSON.stringify([
          { type: "output", text: "SVG OS Terminal \u2014 JavaScript sandbox" },
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
      props: { w: 480, h: 360, url: "https://example.com", label: "WebView" },
    });
  }, [editor]);

  const placeSvgView = useCallback((typeId: string) => {
    const o = offset();
    try {
      const nt = getNodeType(typeId) as {
        template_svg: string;
        default_width: number;
        default_height: number;
      };
      const maxSize = 280;
      const scale = Math.min(maxSize / nt.default_width, maxSize / nt.default_height, 1);
      const w = nt.default_width * scale;
      const h = nt.default_height * scale;
      const center = editor.getViewportScreenCenter();

      // Pre-render with dummy data so it looks real
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
    } catch (e) {
      console.error(`Failed to place ${typeId}:`, e);
    }
  }, [editor]);

  const placeAI = useCallback(() => {
    const o = offset();
    const center = editor.getViewportScreenCenter();
    editor.createShape({
      type: "ai-node",
      x: center.x - 200 + o.x,
      y: center.y - 160 + o.y,
      props: {
        w: 400, h: 320, label: "AI",
        prompt: "", response: "",
        model: getModel(),
        status: "idle", errorMessage: "",
      },
    });
  }, [editor]);

  const placeDataNode = useCallback(() => {
    const o = offset();
    const center = editor.getViewportScreenCenter();
    editor.createShape({
      type: "data-node",
      x: center.x - 80 + o.x,
      y: center.y - 24 + o.y,
      props: { w: 300, h: 200, dataJson: '{\n  "name": "Example",\n  "score": 95,\n  "tags": ["alpha", "beta"]\n}', label: "Data" },
    });
  }, [editor]);

  const placeTransformNode = useCallback(() => {
    const o = offset();
    const center = editor.getViewportScreenCenter();
    editor.createShape({
      type: "transform-node",
      x: center.x - 90 + o.x,
      y: center.y - 24 + o.y,
      props: { w: 180, h: 48, expression: "$.value", label: "Transform" },
    });
  }, [editor]);

  const templatesReady = svgTemplates.length > 0;

  // ── Render ─────────────────────────────────────────────────────────────────

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

        {/* Primitives */}
        <div style={{ padding: "12px 8px", flex: 1 }}>
          <SectionLabel text="Primitives" />

          <PaletteItem svg={noteSvg} label="Note" color={C.note} onClick={placeNote} />
          <PaletteItem svg={tableSvg} label="Table" color={C.table} onClick={placeTable} />
          <PaletteItem svg={notebookSvg} label="Notebook" color={C.notebook} onClick={placeNotebook} />
          <PaletteItem svg={terminalSvg} label="Terminal" color={C.terminal} onClick={placeTerminal} />
          <PaletteItem svg={webviewSvg} label="WebView" color={C.webview} onClick={placeWebView} />
          <PaletteItem svg={aiSvg} label="AI" color={C.ai} onClick={placeAI} />

          {/* Templates */}
          <div
            onClick={() => setTemplatesOpen(!templatesOpen)}
            style={{
              fontFamily: FONT.mono,
              fontSize: 9,
              fontWeight: 500,
              color: C.faint,
              textTransform: "uppercase",
              letterSpacing: "0.1em",
              padding: "16px 8px 6px",
              cursor: "pointer",
              userSelect: "none",
            }}
          >
            {templatesOpen ? "\u25BC" : "\u25B6"} Templates {!templatesReady && <span style={{ color: C.dim }}>(loading)</span>}
          </div>
          {templatesOpen && templatesReady && (
            <>
              {svgTemplates.map(t => (
                <PaletteItem
                  key={t.id}
                  svg={templateSvg}
                  label={t.name}
                  color={C.cyan}
                  onClick={() => placeSvgView(t.id)}
                />
              ))}
            </>
          )}

          {/* Plumbing */}
          <div
            onClick={() => setPlumbingOpen(!plumbingOpen)}
            style={{
              fontFamily: FONT.mono,
              fontSize: 9,
              fontWeight: 500,
              color: C.faint,
              textTransform: "uppercase",
              letterSpacing: "0.1em",
              padding: "16px 8px 6px",
              cursor: "pointer",
              userSelect: "none",
            }}
          >
            {plumbingOpen ? "\u25BC" : "\u25B6"} Plumbing
          </div>
          {plumbingOpen && (
            <>
              <PaletteItem svg={dataSvg} label="Data JSON" color={C.data} onClick={placeDataNode} />
              <PaletteItem svg={exprSvg} label="Expression" color={C.transform} onClick={placeTransformNode} />
            </>
          )}
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

// ── SectionLabel ─────────────────────────────────────────────────────────────

function SectionLabel({ text }: { text: string }) {
  return (
    <div style={{
      fontFamily: FONT.mono,
      fontSize: 9,
      fontWeight: 500,
      color: C.faint,
      textTransform: "uppercase",
      letterSpacing: "0.1em",
      padding: "0 8px 8px",
    }}>
      {text}
    </div>
  );
}

// ── PaletteItem ──────────────────────────────────────────────────────────────

function PaletteItem({
  svg,
  label,
  color,
  onClick,
  disabled,
}: {
  svg: (c: string) => string;
  label: string;
  color: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <div
      onClick={disabled ? undefined : onClick}
      style={{
        padding: "7px 10px",
        margin: "1px 0",
        borderRadius: 6,
        cursor: disabled ? "not-allowed" : "pointer",
        fontSize: 12,
        fontFamily: FONT.sans,
        color: disabled ? C.dim : C.fgSoft,
        display: "flex",
        alignItems: "center",
        gap: 10,
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
      <span
        style={{ width: 16, height: 16, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}
        dangerouslySetInnerHTML={{ __html: svg(color) }}
      />
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
}

// ── SVG Icons ────────────────────────────────────────────────────────────────

const noteSvg = (c: string) => `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="1" y="1" width="12" height="12" rx="2" stroke="${c}" stroke-width="1.2"/><line x1="4" y1="4.5" x2="10" y2="4.5" stroke="${c}" stroke-width="1" opacity="0.6"/><line x1="4" y1="7" x2="10" y2="7" stroke="${c}" stroke-width="1" opacity="0.4"/><line x1="4" y1="9.5" x2="8" y2="9.5" stroke="${c}" stroke-width="1" opacity="0.3"/></svg>`;

const tableSvg = (c: string) => `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="1" y="1" width="12" height="12" rx="2" stroke="${c}" stroke-width="1.2"/><line x1="1" y1="5" x2="13" y2="5" stroke="${c}" stroke-width="0.8" opacity="0.5"/><line x1="1" y1="9" x2="13" y2="9" stroke="${c}" stroke-width="0.8" opacity="0.3"/><line x1="5" y1="5" x2="5" y2="13" stroke="${c}" stroke-width="0.8" opacity="0.3"/><line x1="9" y1="5" x2="9" y2="13" stroke="${c}" stroke-width="0.8" opacity="0.3"/></svg>`;

const notebookSvg = (c: string) => `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="1" y="1" width="12" height="12" rx="2" stroke="${c}" stroke-width="1.2"/><rect x="3" y="3" width="8" height="3" rx="1" fill="${c}" opacity="0.2"/><rect x="3" y="8" width="8" height="3" rx="1" fill="${c}" opacity="0.12"/></svg>`;

const terminalSvg = (c: string) => `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="1" y="1" width="12" height="12" rx="2" stroke="${c}" stroke-width="1.2"/><path d="M4 5L6.5 7L4 9" stroke="${c}" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/><line x1="7.5" y1="9" x2="10" y2="9" stroke="${c}" stroke-width="1.2" stroke-linecap="round" opacity="0.5"/></svg>`;

const webviewSvg = (c: string) => `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="5.5" stroke="${c}" stroke-width="1.2"/><ellipse cx="7" cy="7" rx="2.5" ry="5.5" stroke="${c}" stroke-width="0.8" opacity="0.5"/><line x1="1.5" y1="7" x2="12.5" y2="7" stroke="${c}" stroke-width="0.8" opacity="0.4"/></svg>`;

const shaderSvg = (c: string) => `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="1" y="1" width="12" height="12" rx="2" stroke="${c}" stroke-width="1.2"/><circle cx="5" cy="6" r="2" fill="${c}" opacity="0.3"/><circle cx="9" cy="8" r="2.5" fill="${c}" opacity="0.2"/></svg>`;

const aiSvg = (c: string) => `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 2L8.5 5.5L12 7L8.5 8.5L7 12L5.5 8.5L2 7L5.5 5.5Z" stroke="${c}" stroke-width="1.2" stroke-linejoin="round"/></svg>`;

const dataSvg = (c: string) => `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="2" y="4" width="10" height="6" rx="3" stroke="${c}" stroke-width="1.2"/><circle cx="5" cy="7" r="1" fill="${c}" opacity="0.4"/><circle cx="9" cy="7" r="1" fill="${c}" opacity="0.4"/></svg>`;

const exprSvg = (c: string) => `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3 4L7 7L3 10" stroke="${c}" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" opacity="0.5"/><path d="M7 4L11 7L7 10" stroke="${c}" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

const templateSvg = (c: string) => `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="1" y="1" width="12" height="12" rx="2" stroke="${c}" stroke-width="1.2"/><rect x="3" y="3" width="4" height="4" rx="1" fill="${c}" opacity="0.25"/><line x1="9" y1="4" x2="11" y2="4" stroke="${c}" stroke-width="0.8" opacity="0.4"/><line x1="9" y1="6" x2="11" y2="6" stroke="${c}" stroke-width="0.8" opacity="0.3"/><rect x="3" y="9" width="8" height="2" rx="0.5" fill="${c}" opacity="0.15"/></svg>`;

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
