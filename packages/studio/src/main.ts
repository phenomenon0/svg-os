/**
 * SVG OS Studio — Visual Automation Studio
 *
 * Mail merge for graphics: pick template → upload data → map fields →
 * preview grid → export batch as ZIP of PNGs.
 *
 * Uses the SVG OS WASM engine for single-card preview rendering,
 * DOM-side binding for batch export (stateless, parallelizable).
 */

import { loadWasm } from "@svg-os/bridge";

import { registerTemplate, getTemplates } from "./template-gallery.js";
import type { TemplateMeta } from "./template-gallery.js";
import { extractSlots } from "./template-bind.js";
import type { TemplateSlot } from "./template-bind.js";
import { renderBindingPanel } from "./binding-panel.js";
import type { ColumnMapping } from "./binding-panel.js";
import { renderPreviewGrid, setWasmRenderer, setAnimationConfig } from "./preview-panel.js";
import { renderBatch } from "./batch-renderer.js";
import { createZipFromBlobs } from "./zip-export.js";
import { downloadBlob } from "./png-export.js";
import { renderCardViaWasm } from "./wasm-render.js";

import { renderShader, gpuBackend } from "./shader-renderer.js";
import type { ShaderParams } from "./shader-renderer.js";
import { renderPalettePanel } from "./palette-panel.js";
import type { PaletteConfig } from "./palette-panel.js";
import { generatePalette, varyColor } from "./palette-generator.js";

// Template SVGs loaded as raw strings via Vite
import heroCardSvg from "../../../fixtures/templates/hero-card.svg?raw";
import scoutingReportSvg from "../../../fixtures/templates/scouting-report.svg?raw";
import matchCardSvg from "../../../fixtures/templates/match-card.svg?raw";
import gameAchievementSvg from "../../../fixtures/templates/game-achievement.svg?raw";
import shaderPosterSvg from "../../../fixtures/templates/shader-poster.svg?raw";
import profileHudSvg from "../../../fixtures/templates/profile-hud.svg?raw";
import eventFlyerSvg from "../../../fixtures/templates/event-flyer.svg?raw";
import portfolioCardSvg from "../../../fixtures/templates/portfolio-card.svg?raw";
import pricingCardSvg from "../../../fixtures/templates/pricing-card.svg?raw";
import teamCardSvg from "../../../fixtures/templates/team-card.svg?raw";
import brandShowcaseSvg from "../../../fixtures/templates/brand-showcase.svg?raw";
import shaderCardSvg from "../../../fixtures/templates/shader-card.svg?raw";

// ── State ───────────────────────────────────────────────────────────────────

let selectedTemplate: TemplateMeta | null = null;
let dataRows: Record<string, unknown>[] = [];
let dataColumns: string[] = [];
let columnMap: ColumnMapping = {};
let templateSlots: TemplateSlot[] = [];
let isExporting = false;
let wasmReady = false;
let paletteState: PaletteConfig = { baseColor: "#7c3aed", mode: "complementary", enabled: false };
let animationEnabled = false;

// ── DOM refs ────────────────────────────────────────────────────────────────

const galleryContainer = document.getElementById("gallery-container")!;
const previewArea = document.getElementById("preview-area")!;
const emptyState = document.getElementById("empty-state")!;
const bindingContainer = document.getElementById("binding-container")!;
const bindingEmpty = document.getElementById("binding-empty")!;
const headerStatus = document.getElementById("header-status")!;
const wasmBadge = document.getElementById("wasm-badge")!;

const btnUploadCsv = document.getElementById("btn-upload-csv") as HTMLButtonElement;
const btnUploadJson = document.getElementById("btn-upload-json") as HTMLButtonElement;
const btnSampleData = document.getElementById("btn-sample-data") as HTMLButtonElement;
const btnExport = document.getElementById("btn-export") as HTMLButtonElement;

const csvInput = document.getElementById("csv-input") as HTMLInputElement;
const jsonInput = document.getElementById("json-input") as HTMLInputElement;

const dataPreview = document.getElementById("data-preview")!;
const dataColumnsEl = document.getElementById("data-columns")!;

const exportCount = document.getElementById("export-count")!;
const exportScale = document.getElementById("export-scale") as HTMLSelectElement;
const exportBg = document.getElementById("export-bg") as HTMLSelectElement;
const progressBar = document.getElementById("progress-bar")!;
const progressText = document.getElementById("progress-text")!;

// ── WASM Badge ──────────────────────────────────────────────────────────────

function updateWasmBadge(active: boolean): void {
  if (active) {
    wasmBadge.classList.add("active");
    wasmBadge.innerHTML = '<span class="dot"></span>Engine Active';
  } else {
    wasmBadge.classList.remove("active");
    wasmBadge.innerHTML = '<span class="dot"></span>DOM Mode';
  }
}

function updateGpuBadge(): void {
  const backend = gpuBackend;
  if (backend === "none") return;
  const label = backend === "webgpu" ? "WebGPU" : "WebGL2";
  console.log(`[SVG OS Studio] GPU shader backend: ${label}`);
}

// ── Template Registration ───────────────────────────────────────────────────

function registerBuiltinTemplates(): void {
  // ── Game-Inspired Templates ──────────────────────────────────────────

  registerTemplate({
    id: "hero-card",
    name: "Hero Card",
    description: "Gacha/RPG character card with element theming",
    svgContent: heroCardSvg,
    cardWidth: 400,
    cardHeight: 560,
    slots: [
      { name: "name", type: "text" },
      { name: "title", type: "text" },
      { name: "element", type: "text" },
      { name: "stars", type: "text" },
      { name: "atk", type: "number" },
      { name: "def", type: "number" },
      { name: "spd", type: "number" },
      { name: "hp", type: "number" },
      { name: "atk_width", type: "number" },
      { name: "def_width", type: "number" },
      { name: "spd_width", type: "number" },
      { name: "hp_width", type: "number" },
      { name: "color_a", type: "color" },
      { name: "color_b", type: "color" },
    ],
    sampleData: [
      { name: "KAEL STORMBRINGER", title: "Wind Elemental", element: "WIND", stars: "\u2605\u2605\u2605\u2605\u2605", atk: 85, def: 67, spd: 92, hp: 75, atk_width: 200, def_width: 160, spd_width: 220, hp_width: 180, color_a: "#7c3aed", color_b: "#1e1b4b" },
      { name: "THORNE IRONFIST", title: "Earth Guardian", element: "EARTH", stars: "\u2605\u2605\u2605\u2605", atk: 72, def: 95, spd: 45, hp: 98, atk_width: 172, def_width: 228, spd_width: 108, hp_width: 235, color_a: "#22c55e", color_b: "#052e16" },
      { name: "SERAPHINA BLAZE", title: "Fire Sorceress", element: "FIRE", stars: "\u2605\u2605\u2605\u2605\u2605", atk: 98, def: 42, spd: 88, hp: 60, atk_width: 235, def_width: 100, spd_width: 210, hp_width: 144, color_a: "#ef4444", color_b: "#450a0a" },
      { name: "NAMI TIDECALLER", title: "Water Priestess", element: "WATER", stars: "\u2605\u2605\u2605\u2605", atk: 65, def: 80, spd: 70, hp: 90, atk_width: 156, def_width: 192, spd_width: 168, hp_width: 216, color_a: "#06b6d4", color_b: "#042f2e" },
      { name: "VEX SHADOWSTEP", title: "Void Assassin", element: "VOID", stars: "\u2605\u2605\u2605\u2605\u2605", atk: 95, def: 35, spd: 99, hp: 50, atk_width: 228, def_width: 84, spd_width: 238, hp_width: 120, color_a: "#8b5cf6", color_b: "#0f0a2e" },
      { name: "GAIA ROOTWARDEN", title: "Nature Shaman", element: "EARTH", stars: "\u2605\u2605\u2605", atk: 55, def: 88, spd: 60, hp: 95, atk_width: 132, def_width: 210, spd_width: 144, hp_width: 228, color_a: "#10b981", color_b: "#022c22" },
    ],
  });

  registerTemplate({
    id: "scouting-report",
    name: "Scouting Report",
    description: "FIFA Ultimate Team / sports card",
    svgContent: scoutingReportSvg,
    cardWidth: 400,
    cardHeight: 560,
    slots: [
      { name: "overall", type: "text" },
      { name: "position", type: "text" },
      { name: "name", type: "text" },
      { name: "nationality", type: "text" },
      { name: "pac", type: "number" },
      { name: "sho", type: "number" },
      { name: "pas", type: "number" },
      { name: "dri", type: "number" },
      { name: "def_stat", type: "number" },
      { name: "phy", type: "number" },
      { name: "tier", type: "text" },
      { name: "color_a", type: "color" },
      { name: "color_b", type: "color" },
      { name: "color_c", type: "color" },
    ],
    sampleData: [
      { overall: "94", position: "ST", name: "MARCUS VALENCIA", nationality: "SPAIN", pac: 96, sho: 93, pas: 78, dri: 90, def_stat: 42, phy: 84, tier: "ICON", color_a: "#d4a843", color_b: "#c49b38", color_c: "#a07d2a" },
      { overall: "91", position: "CM", name: "YUKI NAKAMURA", nationality: "JAPAN", pac: 82, sho: 85, pas: 94, dri: 91, def_stat: 78, phy: 70, tier: "TEAM OF THE YEAR", color_a: "#3b82f6", color_b: "#1d4ed8", color_c: "#1e3a5f" },
      { overall: "88", position: "CB", name: "KOFI MENSAH", nationality: "GHANA", pac: 75, sho: 45, pas: 68, dri: 55, def_stat: 92, phy: 90, tier: "GOLD", color_a: "#d4a843", color_b: "#b8942f", color_c: "#8a6d1f" },
      { overall: "86", position: "GK", name: "ELENA PETROVA", nationality: "RUSSIA", pac: 50, sho: 25, pas: 72, dri: 40, def_stat: 88, phy: 82, tier: "RARE GOLD", color_a: "#d4a843", color_b: "#c49b38", color_c: "#9a7a28" },
      { overall: "92", position: "RW", name: "LUCAS DEMBELE", nationality: "FRANCE", pac: 97, sho: 88, pas: 82, dri: 95, def_stat: 35, phy: 68, tier: "FUTURE STARS", color_a: "#a855f7", color_b: "#7c3aed", color_c: "#3b1f6e" },
      { overall: "85", position: "LB", name: "AISHA OKAFOR", nationality: "NIGERIA", pac: 88, sho: 55, pas: 78, dri: 80, def_stat: 84, phy: 76, tier: "SILVER", color_a: "#94a3b8", color_b: "#64748b", color_c: "#334155" },
    ],
  });

  registerTemplate({
    id: "match-card",
    name: "Match Card",
    description: "Esports tournament match result",
    svgContent: matchCardSvg,
    cardWidth: 1080,
    cardHeight: 480,
    slots: [
      { name: "team_a", type: "text" },
      { name: "team_b", type: "text" },
      { name: "score_a", type: "text" },
      { name: "score_b", type: "text" },
      { name: "tournament", type: "text" },
      { name: "stage", type: "text" },
      { name: "game", type: "text" },
      { name: "date", type: "text" },
      { name: "broadcast", type: "text" },
      { name: "color_a", type: "color" },
      { name: "color_b", type: "color" },
      { name: "accent", type: "color" },
    ],
    sampleData: [
      { team_a: "CLOUD9", team_b: "FNATIC", score_a: "3", score_b: "1", tournament: "VALORANT CHAMPIONS TOUR", stage: "GRAND FINAL", game: "VALORANT", date: "MARCH 21, 2026", broadcast: "TWITCH \u00b7 YOUTUBE", color_a: "#3b82f6", color_b: "#ef4444", accent: "#f59e0b" },
      { team_a: "T1", team_b: "GEN.G", score_a: "3", score_b: "2", tournament: "LEAGUE CHAMPIONS KOREA", stage: "PLAYOFFS ROUND 4", game: "LEAGUE OF LEGENDS", date: "MARCH 15, 2026", broadcast: "TWITCH \u00b7 AfreecaTV", color_a: "#ef4444", color_b: "#f59e0b", accent: "#a855f7" },
      { team_a: "NAVI", team_b: "FAZE", score_a: "2", score_b: "0", tournament: "IEM KATOWICE 2026", stage: "GRAND FINAL", game: "CS2", date: "FEBRUARY 28, 2026", broadcast: "TWITCH \u00b7 STEAM.TV", color_a: "#f59e0b", color_b: "#ef4444", accent: "#06b6d4" },
      { team_a: "SENTINELS", team_b: "LOUD", score_a: "3", score_b: "2", tournament: "VCT MASTERS TOKYO", stage: "UPPER FINAL", game: "VALORANT", date: "APRIL 5, 2026", broadcast: "TWITCH \u00b7 YOUTUBE", color_a: "#dc2626", color_b: "#22c55e", accent: "#f59e0b" },
      { team_a: "EG", team_b: "100T", score_a: "2", score_b: "1", tournament: "VCT AMERICAS LEAGUE", stage: "WEEK 6", game: "VALORANT", date: "MARCH 8, 2026", broadcast: "TWITCH", color_a: "#3b82f6", color_b: "#ef4444", accent: "#8b5cf6" },
    ],
  });

  registerTemplate({
    id: "game-achievement",
    name: "Game Achievement",
    description: "Xbox/Steam-style achievement unlock",
    svgContent: gameAchievementSvg,
    cardWidth: 480,
    cardHeight: 280,
    slots: [
      { name: "name", type: "text" },
      { name: "description", type: "text" },
      { name: "xp", type: "text" },
      { name: "rarity", type: "text" },
      { name: "progress", type: "text" },
      { name: "progress_width", type: "number" },
      { name: "date", type: "text" },
      { name: "color_a", type: "color" },
      { name: "color_b", type: "color" },
      { name: "icon_bg", type: "color" },
    ],
    sampleData: [
      { name: "DRAGON SLAYER", description: "Defeat the ancient dragon in under 2 minutes", xp: "+2500 XP", rarity: "LEGENDARY", progress: "100%", progress_width: 280, date: "MAR 21, 2026", color_a: "#f59e0b", color_b: "#451a03", icon_bg: "#1a1408" },
      { name: "SPEED DEMON", description: "Complete any level in under 30 seconds", xp: "+1500 XP", rarity: "EPIC", progress: "100%", progress_width: 280, date: "MAR 18, 2026", color_a: "#a855f7", color_b: "#2e1065", icon_bg: "#1a0e2e" },
      { name: "SHARPSHOOTER", description: "Land 500 headshots in multiplayer matches", xp: "+800 XP", rarity: "RARE", progress: "73%", progress_width: 204, date: "IN PROGRESS", color_a: "#3b82f6", color_b: "#172554", icon_bg: "#0c1429" },
      { name: "FIRST BLOOD", description: "Get the first elimination in a match", xp: "+100 XP", rarity: "COMMON", progress: "100%", progress_width: 280, date: "MAR 1, 2026", color_a: "#6b7280", color_b: "#1f2937", icon_bg: "#111318" },
      { name: "UNTOUCHABLE", description: "Win a match without taking any damage", xp: "+3000 XP", rarity: "LEGENDARY", progress: "100%", progress_width: 280, date: "MAR 20, 2026", color_a: "#f59e0b", color_b: "#451a03", icon_bg: "#1a1408" },
      { name: "TEAM PLAYER", description: "Revive 100 teammates in co-op missions", xp: "+600 XP", rarity: "RARE", progress: "45%", progress_width: 126, date: "IN PROGRESS", color_a: "#3b82f6", color_b: "#172554", icon_bg: "#0c1429" },
    ],
  });

  registerTemplate({
    id: "shader-poster",
    name: "Shader Poster",
    description: "Generative art exhibition poster (portrait)",
    svgContent: shaderPosterSvg,
    cardWidth: 1080,
    cardHeight: 1350,
    shaderTemplate: true,
    slots: [
      { name: "title", type: "text" },
      { name: "subtitle", type: "text" },
      { name: "series", type: "text" },
      { name: "edition", type: "text" },
      { name: "artist", type: "text" },
      { name: "pattern_label", type: "text" },
      { name: "render_info", type: "text" },
      { name: "color1", type: "color" },
      { name: "color2", type: "color" },
    ],
    sampleData: [
      { title: "GENESIS", subtitle: "Algorithmic landscapes", series: "SERIES 001", edition: "EDITION 1/1", artist: "ARTIST: SVG OS", pattern_label: "PLASMA SHADER", render_info: "WGSL \u00b7 1080\u00d71350 \u00b7 GPU", color1: "#6b21a8", color2: "#ec4899", seed: 42, pattern: "plasma" },
      { title: "EROSION", subtitle: "Terrain carved by entropy", series: "SERIES 002", edition: "EDITION 1/1", artist: "ARTIST: SVG OS", pattern_label: "SIMPLEX NOISE", render_info: "WGSL \u00b7 1080\u00d71350 \u00b7 5 octaves", color1: "#78350f", color2: "#d4a843", seed: 137, pattern: "noise" },
      { title: "TESSERA", subtitle: "Cellular automata in glass", series: "SERIES 003", edition: "EDITION 1/1", artist: "ARTIST: SVG OS", pattern_label: "VORONOI CELLS", render_info: "WGSL \u00b7 1080\u00d71350 \u00b7 9 cells", color1: "#0891b2", color2: "#064e3b", seed: 88, pattern: "voronoi" },
      { title: "MERIDIAN", subtitle: "Gradients of consciousness", series: "SERIES 004", edition: "EDITION 1/1", artist: "ARTIST: SVG OS", pattern_label: "GRADIENT FLOW", render_info: "WGSL \u00b7 1080\u00d71350 \u00b7 FBM displaced", color1: "#22c55e", color2: "#3b82f6", seed: 256, pattern: "gradient" },
      { title: "PYROCLAST", subtitle: "Molten light from below", series: "SERIES 005", edition: "EDITION 1/1", artist: "ARTIST: SVG OS", pattern_label: "FIRE SHADER", render_info: "WGSL \u00b7 1080\u00d71350 \u00b7 vertical FBM", color1: "#dc2626", color2: "#f97316", seed: 512, pattern: "fire" },
      { title: "NIMBUS", subtitle: "Atmospheric domain warping", series: "SERIES 006", edition: "EDITION 1/1", artist: "ARTIST: SVG OS", pattern_label: "SMOKE SHADER", render_info: "WGSL \u00b7 1080\u00d71350 \u00b7 warped FBM", color1: "#94a3b8", color2: "#1e293b", seed: 777, pattern: "smoke" },
    ],
  });

  registerTemplate({
    id: "profile-hud",
    name: "Profile HUD",
    description: "Game lobby / gamer profile card",
    svgContent: profileHudSvg,
    cardWidth: 480,
    cardHeight: 320,
    slots: [
      { name: "username", type: "text" },
      { name: "level", type: "text" },
      { name: "xp_text", type: "text" },
      { name: "xp_width", type: "number" },
      { name: "wins", type: "text" },
      { name: "kd", type: "text" },
      { name: "winrate", type: "text" },
      { name: "rank", type: "text" },
      { name: "status", type: "text" },
      { name: "color_a", type: "color" },
      { name: "color_b", type: "color" },
      { name: "status_color", type: "color" },
      { name: "rank_color", type: "color" },
    ],
    sampleData: [
      { username: "SHADOWVEX", level: "LVL 247", xp_text: "18,450 / 25,000 XP", xp_width: 195, wins: "1,247", kd: "2.34", winrate: "67.2%", rank: "RADIANT", status: "IN GAME", color_a: "#8b5cf6", color_b: "#1e1b4b", status_color: "#22c55e", rank_color: "#ff4655" },
      { username: "NEONKNIGHT", level: "LVL 182", xp_text: "12,800 / 20,000 XP", xp_width: 166, wins: "856", kd: "1.87", winrate: "58.4%", rank: "DIAMOND", status: "ONLINE", color_a: "#06b6d4", color_b: "#042f2e", status_color: "#22c55e", rank_color: "#b9f2ff" },
      { username: "GHOSTPIXEL", level: "LVL 310", xp_text: "24,100 / 30,000 XP", xp_width: 208, wins: "2,103", kd: "3.12", winrate: "72.8%", rank: "IMMORTAL", status: "IN GAME", color_a: "#ef4444", color_b: "#450a0a", status_color: "#22c55e", rank_color: "#ff4655" },
      { username: "ZEROPING", level: "LVL 95", xp_text: "4,200 / 10,000 XP", xp_width: 109, wins: "312", kd: "1.23", winrate: "49.1%", rank: "PLATINUM", status: "AWAY", color_a: "#f59e0b", color_b: "#451a03", status_color: "#f59e0b", rank_color: "#22d3ee" },
      { username: "COSMICFADE", level: "LVL 420", xp_text: "29,500 / 35,000 XP", xp_width: 219, wins: "3,891", kd: "4.56", winrate: "78.3%", rank: "CHAMPION", status: "ONLINE", color_a: "#ec4899", color_b: "#500724", status_color: "#22c55e", rank_color: "#fbbf24" },
      { username: "BYTESTORM", level: "LVL 15", xp_text: "800 / 2,000 XP", xp_width: 104, wins: "23", kd: "0.67", winrate: "34.8%", rank: "GOLD", status: "ONLINE", color_a: "#22c55e", color_b: "#022c22", status_color: "#22c55e", rank_color: "#fbbf24" },
    ],
  });

  // ── Premium Templates ──────────────────────────────────────────────────
  // (event-flyer, case-study, pricing, team, brand-showcase, shader-card)

  registerTemplate({
    id: "event-flyer",
    name: "Event Flyer",
    description: "Party / event announcement (portrait)",
    svgContent: eventFlyerSvg,
    cardWidth: 1080,
    cardHeight: 1350,
    slots: [
      { name: "event_name", type: "text" },
      { name: "tagline", type: "text" },
      { name: "date", type: "text" },
      { name: "time", type: "text" },
      { name: "venue", type: "text" },
      { name: "address", type: "text" },
      { name: "headliner", type: "text" },
      { name: "supporting", type: "text" },
      { name: "cta", type: "text" },
      { name: "promo_code", type: "text" },
    ],
    sampleData: [
      { event_name: "NEON DRIFT", tagline: "An immersive audiovisual experience", date: "MAR 21, 2026", time: "DOORS 9PM \u00b7 SHOW 10PM", venue: "The Void", address: "42 Warehouse Row, Brooklyn", headliner: "Kai Horizon", supporting: "Prism \u00b7 Midnight Protocol", cta: "GET TICKETS", promo_code: "USE CODE: EARLYBIRD" },
      { event_name: "SIGNAL LOSS", tagline: "Where frequency meets the floor", date: "APR 12, 2026", time: "DOORS 8PM \u00b7 SHOW 9PM", venue: "Berghain East", address: "15 Analog Street, Berlin", headliner: "Zara Voltage", supporting: "Echo Chamber \u00b7 Static Bloom", cta: "RSVP NOW", promo_code: "LIMITED CAPACITY" },
      { event_name: "DEEP END", tagline: "Surrender to the soundscape", date: "MAY 3, 2026", time: "ALL NIGHT \u00b7 11PM-6AM", venue: "Fabric", address: "77A Charterhouse St, London", headliner: "Orbital Machine", supporting: "Dense & Pika \u00b7 Saoirse", cta: "BUY TICKETS", promo_code: "SOLD OUT SOON" },
    ],
  });

  registerTemplate({
    id: "portfolio-card",
    name: "Case Study",
    description: "Portfolio / OG card (1200\u00d7630)",
    svgContent: portfolioCardSvg,
    cardWidth: 1200,
    cardHeight: 630,
    slots: [
      { name: "category", type: "text" },
      { name: "project_name", type: "text" },
      { name: "description", type: "text" },
      { name: "metric_1_value", type: "text" },
      { name: "metric_1_label", type: "text" },
      { name: "metric_2_value", type: "text" },
      { name: "metric_2_label", type: "text" },
      { name: "metric_3_value", type: "text" },
      { name: "metric_3_label", type: "text" },
      { name: "tech_1", type: "text" },
      { name: "tech_2", type: "text" },
      { name: "tech_3", type: "text" },
      { name: "author", type: "text" },
      { name: "role", type: "text" },
      { name: "url", type: "text" },
    ],
    sampleData: [
      { category: "CASE STUDY", project_name: "SVG OS Runtime", description: "A WASM-powered document engine for generative SVG", metric_1_value: "88", metric_1_label: "TESTS", metric_2_value: "32+", metric_2_label: "EXPORTS", metric_3_value: "<1ms", metric_3_label: "RENDER", tech_1: "Rust", tech_2: "WASM", tech_3: "TypeScript", author: "Femi Adeniran", role: "Creator", url: "svg-os.dev" },
      { category: "SHIPPED", project_name: "Rawcut Editor", description: "Browser-based video editor with GPU acceleration", metric_1_value: "4K", metric_1_label: "RESOLUTION", metric_2_value: "60fps", metric_2_label: "PREVIEW", metric_3_value: "0", metric_3_label: "UPLOADS", tech_1: "WebCodecs", tech_2: "Canvas", tech_3: "FFmpeg", author: "Femi Adeniran", role: "Creator", url: "rawcut.dev" },
    ],
  });

  registerTemplate({
    id: "pricing-card",
    name: "Pricing Tier",
    description: "SaaS pricing card (glassmorphism)",
    svgContent: pricingCardSvg,
    cardWidth: 400,
    cardHeight: 500,
    slots: [
      { name: "badge_text", type: "text" },
      { name: "tier_name", type: "text" },
      { name: "price", type: "text" },
      { name: "period", type: "text" },
      { name: "description", type: "text" },
      { name: "feature_1", type: "text" },
      { name: "feature_2", type: "text" },
      { name: "feature_3", type: "text" },
      { name: "feature_4", type: "text" },
      { name: "feature_5", type: "text" },
      { name: "cta", type: "text" },
      { name: "badge_color", type: "color" },
      { name: "cta_color", type: "color" },
    ],
    sampleData: [
      { badge_text: "FREE FOREVER", tier_name: "Starter", price: "$0", period: "/month", description: "For side projects", feature_1: "3 projects", feature_2: "Community support", feature_3: "1GB storage", feature_4: "Basic analytics", feature_5: "Public templates", cta: "Get Started", badge_color: "#334155", cta_color: "#334155" },
      { badge_text: "MOST POPULAR", tier_name: "Pro", price: "$29", period: "/month", description: "For growing teams", feature_1: "Unlimited projects", feature_2: "Priority support", feature_3: "100GB storage", feature_4: "Advanced analytics", feature_5: "Custom domains", cta: "Start Free Trial", badge_color: "#f59e0b", cta_color: "#f59e0b" },
      { badge_text: "BEST VALUE", tier_name: "Enterprise", price: "$99", period: "/month", description: "For organizations", feature_1: "Everything in Pro", feature_2: "SSO & SAML", feature_3: "Unlimited storage", feature_4: "Audit logs", feature_5: "Dedicated support", cta: "Contact Sales", badge_color: "#8b5cf6", cta_color: "#8b5cf6" },
    ],
  });

  registerTemplate({
    id: "team-card",
    name: "Team Member",
    description: "Team profile card with photo",
    svgContent: teamCardSvg,
    cardWidth: 360,
    cardHeight: 480,
    slots: [
      { name: "name", type: "text" },
      { name: "role", type: "text" },
      { name: "company", type: "text" },
      { name: "quote", type: "text" },
      { name: "social_1", type: "text" },
      { name: "social_2", type: "text" },
      { name: "location", type: "text" },
      { name: "accent_color", type: "color" },
    ],
    sampleData: [
      { name: "Sarah Chen", role: "CEO & Co-founder", company: "Acme Corp", quote: "Build things people actually want", social_1: "@sarahc", social_2: "in/sarahchen", location: "San Francisco, CA", accent_color: "#f59e0b" },
      { name: "Marcus Rivera", role: "CTO", company: "Acme Corp", quote: "Simple systems scale better", social_1: "@mrivera", social_2: "in/marcusr", location: "Austin, TX", accent_color: "#8b5cf6" },
      { name: "Aisha Patel", role: "Head of Design", company: "Acme Corp", quote: "Every pixel tells a story", social_1: "@aishap", social_2: "in/aishapatel", location: "London, UK", accent_color: "#ec4899" },
      { name: "Kai Okonkwo", role: "Lead Engineer", company: "Acme Corp", quote: "Rust in prod, sleep at night", social_1: "@kaio", social_2: "in/kaiok", location: "Lagos, Nigeria", accent_color: "#22c55e" },
    ],
  });

  // ── One-to-Many Paradigm Templates ─────────────────────────────────────

  registerTemplate({
    id: "brand-showcase",
    name: "Brand Showcase",
    description: "One template, many brand atmospheres (1080\u00B2)",
    svgContent: brandShowcaseSvg,
    cardWidth: 1080,
    cardHeight: 1080,
    slots: [
      { name: "brand_name", type: "text" },
      { name: "tagline", type: "text" },
      { name: "body", type: "text" },
      { name: "cta", type: "text" },
      { name: "edition", type: "text" },
      { name: "detail", type: "text" },
      { name: "metric_value", type: "text" },
      { name: "metric_label", type: "text" },
      { name: "metric_value_2", type: "text" },
      { name: "metric_label_2", type: "text" },
      { name: "color_a", type: "color" },
      { name: "color_b", type: "color" },
      { name: "color_c", type: "color" },
    ],
    sampleData: [
      { brand_name: "NEBULA LABS", tagline: "Designed for the future", body: "Where innovation meets intention. Built for what comes next.", cta: "EXPLORE", edition: "EDITION 001", detail: "CRAFTED WITH PRECISION", metric_value: "2.4M+", metric_label: "IMPRESSIONS", metric_value_2: "98%", metric_label_2: "SATISFACTION", color_a: "#7c3aed", color_b: "#be185d", color_c: "#1e1b4b" },
      { brand_name: "SOLARIS", tagline: "Energy meets elegance", body: "Harnessing the spectrum. From dawn frequencies to dusk wavelengths.", cta: "DISCOVER", edition: "SERIES II", detail: "POWERED BY LIGHT", metric_value: "340K", metric_label: "ACTIVE USERS", metric_value_2: "4.9\u2605", metric_label_2: "RATING", color_a: "#f59e0b", color_b: "#ea580c", color_c: "#451a03" },
      { brand_name: "AQUATICA", tagline: "Flow with precision", body: "Fluid dynamics meet digital craft. Every pixel, a ripple.", cta: "DIVE IN", edition: "DEPTH 003", detail: "ENGINEERED FOR DEPTH", metric_value: "12ms", metric_label: "RESPONSE TIME", metric_value_2: "99.97%", metric_label_2: "UPTIME", color_a: "#06b6d4", color_b: "#0891b2", color_c: "#042f2e" },
      { brand_name: "EMBER", tagline: "Bold by nature", body: "The heat of conviction. Unapologetically present, impossible to ignore.", cta: "IGNITE", edition: "FORGE 001", detail: "FORGED IN FIRE", metric_value: "850+", metric_label: "BRANDS SERVED", metric_value_2: "3X", metric_label_2: "GROWTH RATE", color_a: "#e11d48", color_b: "#be123c", color_c: "#1c1917" },
      { brand_name: "VERDANT", tagline: "Naturally engineered", body: "Growth algorithms inspired by mycelial networks. Organic intelligence.", cta: "GROW", edition: "BLOOM 002", detail: "ROOTED IN SCIENCE", metric_value: "47%", metric_label: "CO2 REDUCED", metric_value_2: "1.2B", metric_label_2: "DATA POINTS", color_a: "#10b981", color_b: "#059669", color_c: "#022c22" },
      { brand_name: "OBSIDIAN", tagline: "Refined darkness", body: "Luxury carved from shadow. For those who see clearly in the dark.", cta: "ENTER", edition: "NOIR 001", detail: "FORGED UNDER PRESSURE", metric_value: "18K", metric_label: "MEMBERS", metric_value_2: "100%", metric_label_2: "INVITE ONLY", color_a: "#6366f1", color_b: "#4338ca", color_c: "#0c0a09" },
      { brand_name: "HELIOTROPE", tagline: "Follow the light", body: "Solar-tracking design systems. Interfaces that adapt to your rhythm.", cta: "BLOOM", edition: "CYCLE 004", detail: "PHOTOTROPIC DESIGN", metric_value: "60fps", metric_label: "RENDER SPEED", metric_value_2: "0ms", metric_label_2: "JANK", color_a: "#d946ef", color_b: "#a855f7", color_c: "#1a0826" },
    ],
  });

  registerTemplate({
    id: "shader-card",
    name: "Shader Card",
    description: "GPU-generated backgrounds (WebGPU/WebGL2)",
    svgContent: shaderCardSvg,
    cardWidth: 1080,
    cardHeight: 1080,
    shaderTemplate: true,
    slots: [
      { name: "title", type: "text" },
      { name: "subtitle", type: "text" },
      { name: "pattern_label", type: "text" },
      { name: "render_info", type: "text" },
      { name: "seed_info", type: "text" },
      { name: "params_line", type: "text" },
      { name: "color1", type: "color" },
      { name: "color2", type: "color" },
    ],
    sampleData: [
      { title: "NEBULA", subtitle: "Deep space generative art", pattern_label: "PLASMA SHADER", render_info: "WGSL \u00B7 1080px \u00B7 60fps", seed_info: "SEED: 42", params_line: "COLOR_A: #6B21A8 \u00B7 COLOR_B: #EC4899", color1: "#6b21a8", color2: "#ec4899", seed: 42, pattern: "plasma" },
      { title: "FLARE", subtitle: "Captured in code", pattern_label: "SIMPLEX NOISE", render_info: "WGSL \u00B7 1080px \u00B7 5 octaves", seed_info: "SEED: 137", params_line: "COLOR_A: #F59E0B \u00B7 COLOR_B: #EF4444", color1: "#f59e0b", color2: "#ef4444", seed: 137, pattern: "noise" },
      { title: "ABYSS", subtitle: "Algorithmic depths", pattern_label: "VORONOI CELLS", render_info: "WGSL \u00B7 1080px \u00B7 9 cells", seed_info: "SEED: 88", params_line: "COLOR_A: #0891B2 \u00B7 COLOR_B: #064E3B", color1: "#0891b2", color2: "#064e3b", seed: 88, pattern: "voronoi" },
      { title: "AURORA", subtitle: "Northern lights, computed", pattern_label: "GRADIENT FLOW", render_info: "WGSL \u00B7 1080px \u00B7 FBM displaced", seed_info: "SEED: 256", params_line: "COLOR_A: #22C55E \u00B7 COLOR_B: #3B82F6", color1: "#22c55e", color2: "#3b82f6", seed: 256, pattern: "gradient" },
      { title: "MAGMA", subtitle: "Subsurface luminance", pattern_label: "PLASMA SHADER", render_info: "WGSL \u00B7 1080px \u00B7 4 harmonics", seed_info: "SEED: 512", params_line: "COLOR_A: #DC2626 \u00B7 COLOR_B: #F97316", color1: "#dc2626", color2: "#f97316", seed: 512, pattern: "plasma" },
      { title: "TUNDRA", subtitle: "Crystalline static", pattern_label: "SIMPLEX NOISE", render_info: "WGSL \u00B7 1080px \u00B7 high freq", seed_info: "SEED: 777", params_line: "COLOR_A: #94A3B8 \u00B7 COLOR_B: #1E3A5F", color1: "#94a3b8", color2: "#1e3a5f", seed: 777, pattern: "noise" },
      { title: "ORION", subtitle: "Raymarched celestial body", pattern_label: "SPHERE SDF", render_info: "WGSL \u00B7 1080px \u00B7 48 steps", seed_info: "SEED: 333", params_line: "COLOR_A: #7C3AED \u00B7 COLOR_B: #0F172A", color1: "#7c3aed", color2: "#0f172a", seed: 333, pattern: "sphere" },
      { title: "CUMULUS", subtitle: "Volumetric atmospheric fog", pattern_label: "CLOUD VOLUME", render_info: "WGSL \u00B7 1080px \u00B7 32 steps", seed_info: "SEED: 444", params_line: "COLOR_A: #CBD5E1 \u00B7 COLOR_B: #1E3A5F", color1: "#cbd5e1", color2: "#1e3a5f", seed: 444, pattern: "clouds" },
      { title: "DIVINE", subtitle: "Radial light from the heavens", pattern_label: "GOD RAYS", render_info: "WGSL \u00B7 1080px \u00B7 16 samples", seed_info: "SEED: 555", params_line: "COLOR_A: #F59E0B \u00B7 COLOR_B: #1C1917", color1: "#f59e0b", color2: "#1c1917", seed: 555, pattern: "godrays" },
    ],
  });
}

// ── Gallery Rendering ───────────────────────────────────────────────────────

function renderGallery(): void {
  galleryContainer.innerHTML = "";
  const templates = getTemplates();

  for (const tmpl of templates) {
    const card = document.createElement("div");
    card.className = "gallery-card";
    card.dataset.templateId = tmpl.id;

    const thumb = document.createElement("div");
    thumb.className = "gallery-thumb";
    thumb.innerHTML = tmpl.svgContent;
    const svg = thumb.querySelector("svg");
    if (svg) {
      svg.removeAttribute("width");
      svg.removeAttribute("height");
      svg.style.maxWidth = "100%";
      svg.style.maxHeight = "90px";
    }
    card.appendChild(thumb);

    const info = document.createElement("div");
    info.className = "gallery-info";
    info.innerHTML = `
      <div class="gallery-name">${tmpl.name}</div>
      <div class="gallery-desc">${tmpl.description}</div>
      <div class="gallery-dims">${tmpl.cardWidth} &times; ${tmpl.cardHeight}px</div>
    `;
    card.appendChild(info);

    card.addEventListener("click", () => selectTemplate(tmpl));
    galleryContainer.appendChild(card);
  }
}

function selectTemplate(tmpl: TemplateMeta): void {
  selectedTemplate = tmpl;

  // Highlight selected card
  for (const el of galleryContainer.querySelectorAll(".gallery-card")) {
    el.classList.toggle("selected", (el as HTMLElement).dataset.templateId === tmpl.id);
  }

  // Extract bindable slots from SVG
  const parser = new DOMParser();
  const doc = parser.parseFromString(tmpl.svgContent, "image/svg+xml");
  templateSlots = extractSlots(doc.documentElement);

  // Reset column map
  columnMap = {};

  updateStatus();
  updateBindingPanel();
  updatePalettePanel();
  updatePreview();
}

// ── Data Loading ────────────────────────────────────────────────────────────

function loadData(rows: Record<string, unknown>[]): void {
  dataRows = rows;
  dataColumns = rows.length > 0 ? Object.keys(rows[0]) : [];
  columnMap = {};

  // Show preview of first row
  if (rows.length > 0) {
    dataPreview.style.display = "block";
    const preview = rows.slice(0, 2).map((r) => JSON.stringify(r, null, 0)).join("\n");
    dataPreview.textContent = rows.length > 2
      ? `${preview}\n... (${rows.length} rows total)`
      : preview;
  } else {
    dataPreview.style.display = "none";
  }

  // Show column tags
  dataColumnsEl.innerHTML = "";
  for (const col of dataColumns) {
    const tag = document.createElement("span");
    tag.className = "column-tag";
    tag.textContent = col;
    dataColumnsEl.appendChild(tag);
  }

  updateStatus();
  updateBindingPanel();
  updatePalettePanel();
  updatePreview();
}

function parseCSV(text: string): Record<string, unknown>[] {
  const lines = text.trim().split("\n");
  if (lines.length < 2) return [];

  const headers = parseCSVRow(lines[0]);
  const rows: Record<string, unknown>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVRow(lines[i]);
    if (values.length === 0) continue;
    const row: Record<string, unknown> = {};
    for (let j = 0; j < headers.length; j++) {
      const val = values[j] ?? "";
      const num = Number(val);
      row[headers[j]] = val !== "" && !isNaN(num) ? num : val;
    }
    rows.push(row);
  }
  return rows;
}

function parseCSVRow(line: string): string[] {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        values.push(current.trim());
        current = "";
      } else {
        current += ch;
      }
    }
  }
  values.push(current.trim());
  return values;
}

// ── Binding Panel ───────────────────────────────────────────────────────────

let bindingCleanup: (() => void) | null = null;

function updateBindingPanel(): void {
  if (bindingCleanup) {
    bindingCleanup();
    bindingCleanup = null;
  }

  if (!selectedTemplate || templateSlots.length === 0 || dataColumns.length === 0) {
    bindingEmpty.style.display = "block";
    if (!selectedTemplate) {
      bindingEmpty.textContent = "Select a template and upload data to map fields.";
    } else if (dataColumns.length === 0) {
      bindingEmpty.textContent = "Upload data (CSV or JSON) to map fields.";
    }
    return;
  }

  bindingEmpty.style.display = "none";

  let panelContent = bindingContainer.querySelector(".binding-panel-content") as HTMLElement;
  if (!panelContent) {
    panelContent = document.createElement("div");
    panelContent.className = "binding-panel-content";
    bindingContainer.appendChild(panelContent);
  }

  const result = renderBindingPanel(
    panelContent,
    templateSlots,
    dataColumns,
    columnMap,
    (newMapping) => {
      columnMap = newMapping;
      updatePreview();
    },
  );

  bindingCleanup = result.cleanup;
}

// ── Palette Panel ───────────────────────────────────────────────────────────

let paletteCleanup: (() => void) | null = null;

function updatePalettePanel(): void {
  if (paletteCleanup) {
    paletteCleanup();
    paletteCleanup = null;
  }

  let paletteContainer = document.getElementById("palette-container");
  if (!paletteContainer) return;

  if (!selectedTemplate || dataColumns.length === 0) {
    paletteContainer.innerHTML = "";
    return;
  }

  const result = renderPalettePanel(paletteContainer, paletteState, (newConfig) => {
    paletteState = newConfig;
    updatePreview();
  });

  paletteCleanup = result.cleanup;
}

/**
 * Apply palette colors to rows — non-destructive.
 * For each row, fills color_a/color_b/color_c slots with palette-varied colors.
 * For shader templates, also sets color1/color2.
 */
function applyPaletteToRows(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  if (!paletteState.enabled) return rows;

  const palette = generatePalette(paletteState.baseColor, paletteState.mode, rows.length * 2);
  const isShader = selectedTemplate?.shaderTemplate ?? false;

  return rows.map((row, i) => {
    const primary = varyColor(palette[i % palette.length], i, rows.length);
    const secondary = varyColor(palette[(i + 1) % palette.length], i, rows.length);
    const result = { ...row };

    // Fill color slots for non-shader templates
    if (row.color_a !== undefined) result.color_a = primary;
    if (row.color_b !== undefined) result.color_b = secondary;
    if (row.color_c !== undefined) {
      const tertiary = varyColor(palette[(i + 2) % palette.length], i, rows.length);
      result.color_c = tertiary;
    }
    if (row.accent_color !== undefined) result.accent_color = primary;
    if (row.badge_color !== undefined) result.badge_color = primary;
    if (row.cta_color !== undefined) result.cta_color = primary;

    // For shader templates, set color1/color2
    if (isShader) {
      result.color1 = primary;
      result.color2 = secondary;
      // Clear cached shader_bg so it re-renders
      delete result.shader_bg;
    }

    return result;
  });
}

// ── Preview Grid ────────────────────────────────────────────────────────────

async function updatePreview(): Promise<void> {
  if (!selectedTemplate) {
    emptyState.style.display = "flex";
    return;
  }

  emptyState.style.display = "none";

  let rows = dataRows.length > 0 ? dataRows : selectedTemplate.sampleData.slice(0, 1);
  const useData = dataRows.length > 0;

  // Apply palette colors before shader preprocessing
  rows = applyPaletteToRows(rows);

  // For shader templates, preprocess rows to inject shader_bg
  if (selectedTemplate.shaderTemplate) {
    rows = await Promise.all(rows.map(async (row) => {
      if (row.shader_bg) return row; // already preprocessed
      const params: ShaderParams = {
        color1: String(row.color1 ?? "#000000"),
        color2: String(row.color2 ?? "#ffffff"),
        seed: Number(row.seed ?? 0),
        pattern: String(row.pattern ?? "plasma"),
        width: selectedTemplate!.cardWidth,
        height: selectedTemplate!.cardHeight,
      };
      const shaderBg = await renderShader(params);
      return { ...row, shader_bg: shaderBg };
    }));
    updateGpuBadge();
  }

  renderPreviewGrid(previewArea, {
    templateSvg: selectedTemplate.svgContent,
    rows,
    cardWidth: selectedTemplate.cardWidth,
    cardHeight: selectedTemplate.cardHeight,
    columnMap,
  });

  exportCount.textContent = String(useData ? dataRows.length : 0);
  btnExport.disabled = !useData || isExporting;

  updateStatus();
}

// ── Status ──────────────────────────────────────────────────────────────────

function updateStatus(): void {
  const parts: string[] = [];
  if (selectedTemplate) {
    parts.push(selectedTemplate.name);
  }
  if (dataRows.length > 0) {
    parts.push(`${dataRows.length} rows`);
  }
  if (Object.keys(columnMap).length > 0) {
    parts.push(`${Object.keys(columnMap).length} mapped`);
  }
  headerStatus.textContent = parts.length > 0 ? parts.join(" \u00b7 ") : "Select a template to begin";
}

// ── Export ───────────────────────────────────────────────────────────────────

async function exportBatch(): Promise<void> {
  if (!selectedTemplate || dataRows.length === 0 || isExporting) return;

  isExporting = true;
  btnExport.disabled = true;
  btnExport.textContent = "Exporting...";
  progressBar.style.width = "0%";
  progressText.textContent = "0%";

  const scale = Number(exportScale.value) || 2;
  const bgColor = exportBg.value || undefined;

  // Build preprocess hook for shader templates
  const preprocess = selectedTemplate.shaderTemplate
    ? async (row: Record<string, unknown>, _index: number) => {
        const params: ShaderParams = {
          color1: String(row.color1 ?? "#000000"),
          color2: String(row.color2 ?? "#ffffff"),
          seed: Number(row.seed ?? 0),
          pattern: String(row.pattern ?? "plasma"),
          width: typeof row._width === "number" ? row._width : selectedTemplate!.cardWidth,
          height: typeof row._height === "number" ? row._height : selectedTemplate!.cardHeight,
        };
        const shaderBg = await renderShader(params);
        return { ...row, shader_bg: shaderBg };
      }
    : undefined;

  try {
    const result = await renderBatch(
      selectedTemplate.svgContent,
      dataRows,
      selectedTemplate.cardWidth,
      selectedTemplate.cardHeight,
      (progress) => {
        progressBar.style.width = `${progress.percent}%`;
        progressText.textContent = `${progress.percent}%`;
      },
      columnMap,
      scale,
      bgColor,
      preprocess,
    );

    // Package as ZIP
    const items = result.blobs.map((blob, i) => ({
      name: `${selectedTemplate!.id}-${String(i + 1).padStart(3, "0")}.png`,
      blob,
    }));

    const zip = await createZipFromBlobs(items);
    downloadBlob(zip, `${selectedTemplate.id}-batch-${dataRows.length}.zip`);

    const elapsed = (result.elapsed / 1000).toFixed(1);
    const cps = (result.blobs.length / (result.elapsed / 1000)).toFixed(0);
    progressText.textContent = `Done (${elapsed}s \u00b7 ${cps} cards/s)`;
  } catch (err) {
    console.error("Export failed:", err);
    progressText.textContent = "Error!";
    progressBar.style.width = "0%";
  } finally {
    isExporting = false;
    btnExport.disabled = false;
    btnExport.textContent = "Export ZIP";
  }
}

// ── Event Handlers ──────────────────────────────────────────────────────────

btnUploadCsv.addEventListener("click", () => csvInput.click());
btnUploadJson.addEventListener("click", () => jsonInput.click());

csvInput.addEventListener("change", async () => {
  const file = csvInput.files?.[0];
  if (!file) return;
  const text = await file.text();
  const rows = parseCSV(text);
  if (rows.length > 0) {
    loadData(rows);
  }
  csvInput.value = "";
});

jsonInput.addEventListener("change", async () => {
  const file = jsonInput.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    if (rows.length > 0 && typeof rows[0] === "object") {
      loadData(rows);
    }
  } catch (e) {
    console.error("Invalid JSON:", e);
  }
  jsonInput.value = "";
});

btnSampleData.addEventListener("click", () => {
  if (!selectedTemplate) {
    const templates = getTemplates();
    if (templates.length > 0) {
      selectTemplate(templates[0]);
    }
  }
  if (selectedTemplate) {
    loadData(selectedTemplate.sampleData);
  }
});

btnExport.addEventListener("click", () => exportBatch());

// ── Init ────────────────────────────────────────────────────────────────────

async function init(): Promise<void> {
  registerBuiltinTemplates();
  renderGallery();
  updateStatus();

  // Wire animation config — provides shader render function for animated previews
  setAnimationConfig({
    enabled: animationEnabled,
    shaderRenderFn: async (seed: number) => {
      if (!selectedTemplate) return "";
      const row = dataRows[0] ?? selectedTemplate.sampleData[0] ?? {};
      const params: ShaderParams = {
        color1: String(row.color1 ?? "#000000"),
        color2: String(row.color2 ?? "#ffffff"),
        seed,
        pattern: String(row.pattern ?? "plasma"),
        width: 540, // Reduced resolution during animation
        height: 540,
      };
      return renderShader(params);
    },
  });

  // Load WASM engine (graceful fallback if not built)
  try {
    await loadWasm();
    wasmReady = true;
    updateWasmBadge(true);

    // Register WASM renderer for modal previews
    setWasmRenderer((templateSvg, rowData, colMap, container) => {
      return renderCardViaWasm(templateSvg, rowData, colMap, container);
    });
  } catch (e) {
    console.warn("WASM engine not available, using DOM fallback:", e);
    wasmReady = false;
    updateWasmBadge(false);
  }
}

init();
