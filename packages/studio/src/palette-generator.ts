/**
 * Generative color palette system — HSL-based color theory.
 *
 * Given a base hex color, generates harmonious palettes using classical
 * color theory modes: complementary, analogous, triadic, split-complementary,
 * and monochromatic. Also provides per-row variation for subtle diversity.
 */

// ── HSL Types ───────────────────────────────────────────────────────────────

export interface HSL {
  h: number; // 0–360
  s: number; // 0–100
  l: number; // 0–100
}

export type PaletteMode =
  | "complementary"
  | "analogous"
  | "triadic"
  | "split-complementary"
  | "monochromatic";

export const PALETTE_MODES: PaletteMode[] = [
  "complementary",
  "analogous",
  "triadic",
  "split-complementary",
  "monochromatic",
];

// ── Conversion ──────────────────────────────────────────────────────────────

export function hexToHsl(hex: string): HSL {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  const l = (max + min) / 2;

  if (d === 0) return { h: 0, s: 0, l: l * 100 };

  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

  let hue = 0;
  if (max === r) hue = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) hue = ((b - r) / d + 2) / 6;
  else hue = ((r - g) / d + 4) / 6;

  return { h: hue * 360, s: s * 100, l: l * 100 };
}

export function hslToHex(hsl: HSL): string {
  const h = hsl.h / 360;
  const s = hsl.s / 100;
  const l = hsl.l / 100;

  if (s === 0) {
    const v = Math.round(l * 255);
    return `#${v.toString(16).padStart(2, "0").repeat(3)}`;
  }

  const hue2rgb = (p: number, q: number, t: number): number => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const r = Math.round(hue2rgb(p, q, h + 1 / 3) * 255);
  const g = Math.round(hue2rgb(p, q, h) * 255);
  const b = Math.round(hue2rgb(p, q, h - 1 / 3) * 255);

  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

// ── Palette Generation ──────────────────────────────────────────────────────

/** Generate anchor hue offsets for each mode. */
function modeAnchors(mode: PaletteMode, baseH: number): number[] {
  switch (mode) {
    case "complementary":
      return [baseH, (baseH + 180) % 360];
    case "analogous":
      return [(baseH - 30 + 360) % 360, baseH, (baseH + 30) % 360];
    case "triadic":
      return [baseH, (baseH + 120) % 360, (baseH + 240) % 360];
    case "split-complementary":
      return [baseH, (baseH + 150) % 360, (baseH + 210) % 360];
    case "monochromatic":
      return [baseH]; // vary S/L instead
  }
}

/**
 * Generate a palette of `count` colors from a base hex color.
 * Interpolates between anchor hues when count > anchor points.
 */
export function generatePalette(
  baseHex: string,
  mode: PaletteMode,
  count: number = 6,
): string[] {
  const base = hexToHsl(baseHex);
  const anchors = modeAnchors(mode, base.h);

  if (mode === "monochromatic") {
    // Vary saturation and lightness around the base
    const result: string[] = [];
    for (let i = 0; i < count; i++) {
      const t = i / (count - 1 || 1);
      result.push(
        hslToHex({
          h: base.h,
          s: clamp(base.s - 20 + t * 40, 10, 100),
          l: clamp(25 + t * 55, 15, 85),
        }),
      );
    }
    return result;
  }

  // Interpolate between anchor hues
  const result: string[] = [];
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1 || 1);
    const anchorIdx = t * (anchors.length - 1);
    const lo = Math.floor(anchorIdx);
    const hi = Math.min(lo + 1, anchors.length - 1);
    const frac = anchorIdx - lo;

    const h = lerpAngle(anchors[lo], anchors[hi], frac);
    // Vary S/L slightly for visual interest
    const sVariation = (i % 2 === 0 ? 1 : -1) * 5;
    const lVariation = (i % 3 === 0 ? 1 : -1) * 8;

    result.push(
      hslToHex({
        h,
        s: clamp(base.s + sVariation, 15, 100),
        l: clamp(base.l + lVariation, 15, 85),
      }),
    );
  }
  return result;
}

/**
 * Per-row color variation: slightly rotate hue and vary S/L
 * for subtle diversity across batch cards.
 */
export function varyColor(hex: string, index: number, total: number): string {
  const hsl = hexToHsl(hex);
  const hueShift = (index / total) * 15;
  const sShift = ((index % 3) - 1) * 5;
  const lShift = ((index % 4) - 1.5) * 8;

  return hslToHex({
    h: (hsl.h + hueShift) % 360,
    s: clamp(hsl.s + sShift, 10, 100),
    l: clamp(hsl.l + lShift, 10, 90),
  });
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/** Interpolate between two angles on a 360° wheel. */
function lerpAngle(a: number, b: number, t: number): number {
  let diff = b - a;
  if (diff > 180) diff -= 360;
  if (diff < -180) diff += 360;
  return (a + diff * t + 360) % 360;
}
