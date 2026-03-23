/**
 * SVG OS Canvas — Design System
 *
 * Warm dark palette inspired by Gwern/MakingSoftware aesthetic.
 * Premium feel with proper typography hierarchy.
 */

// ── Colors ───────────────────────────────────────────────────────────────────

export const C = {
  // Backgrounds (warm charcoal, not cold navy)
  bg:        "#1a1815",
  bgAlt:     "#211f1b",
  bgDeep:    "#151311",
  bgHover:   "#2d2a27",
  bgCard:    "#242220",

  // Text
  fg:        "#e8e4df",
  fgSoft:    "#d4cfc7",
  muted:     "#a09a90",
  faint:     "#6b6660",
  dim:       "#4a4640",

  // Borders
  border:    "#3a3632",
  borderSoft:"#2d2a27",

  // Accents (warm, muted for dark mode)
  accent:    "#e6a756",   // warm gold — primary accent
  blue:      "#6a9fcf",   // dusty blue
  green:     "#7eb59d",   // sage green
  yellow:    "#d4b86a",   // muted gold
  pink:      "#cf7a9a",   // muted rose
  cyan:      "#7abfb8",   // teal
  purple:    "#a78bca",   // lavender
  orange:    "#d4946a",   // terracotta
  red:       "#c98f8f",   // muted red

  // Node-specific colors
  note:      "#e6a756",   // warm gold
  table:     "#6a9fcf",   // blue
  notebook:  "#a78bca",   // lavender
  terminal:  "#7eb59d",   // sage green
  webview:   "#7abfb8",   // teal
  shader:    "#cf7a9a",   // rose
  ai:        "#8fa4c9",   // dusty blue
  data:      "#7eb59d",   // sage green
  transform: "#a78bca",   // lavender
} as const;

// ── Typography ───────────────────────────────────────────────────────────────

export const FONT = {
  serif:  "'Source Serif 4', 'Source Serif Pro', Georgia, serif",
  sans:   "'Inter', -apple-system, BlinkMacSystemFont, system-ui, sans-serif",
  mono:   "'JetBrains Mono', 'Fira Code', 'IBM Plex Mono', Consolas, monospace",
} as const;

// ── Shared Styles ────────────────────────────────────────────────────────────

export const titleBarStyle: React.CSSProperties = {
  height: 32,
  padding: "0 12px",
  background: C.bgAlt,
  borderBottom: `1px solid ${C.border}`,
  display: "flex",
  alignItems: "center",
  gap: 8,
  flexShrink: 0,
};

export const titleTextStyle: React.CSSProperties = {
  fontFamily: FONT.sans,
  fontSize: 11,
  fontWeight: 500,
  color: C.muted,
  letterSpacing: "0.02em",
};

export const nodeContainerStyle: React.CSSProperties = {
  width: "100%",
  height: "100%",
  background: C.bg,
  border: `1px solid ${C.border}`,
  borderRadius: 8,
  overflow: "hidden",
  display: "flex",
  flexDirection: "column",
  position: "relative",
  boxShadow: "0 2px 12px rgba(0,0,0,0.35)",
};

export const monoInputStyle: React.CSSProperties = {
  background: "transparent",
  border: "none",
  color: C.fg,
  fontSize: 13,
  fontFamily: FONT.mono,
  resize: "none" as const,
  outline: "none",
  lineHeight: 1.6,
};

export function accentDot(color: string): React.CSSProperties {
  return {
    width: 6,
    height: 6,
    borderRadius: "50%",
    background: color,
    flexShrink: 0,
  };
}

export function pillButton(color: string, active = false): React.CSSProperties {
  return {
    background: active ? `${color}22` : "transparent",
    border: `1px solid ${color}55`,
    borderRadius: 4,
    color,
    fontSize: 10,
    padding: "2px 8px",
    cursor: "pointer",
    fontFamily: FONT.sans,
    fontWeight: 500,
    letterSpacing: "0.02em",
    transition: "all 0.15s ease",
  };
}
