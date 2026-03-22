/**
 * Cards demo entry point — 100 Cards in 3 Seconds.
 *
 * Five visually distinct templates, each using curated sample data
 * from the studio, expanded to 100 with controlled variation.
 *
 * Pipeline: shader-renderer (GPU textures) → template-bind → png-export → zip-export.
 */

import { renderShader, gpuBackend } from "../../studio/src/shader-renderer.ts";
import { resolveTemplateSvg } from "../../studio/src/template-bind.ts";
import { svgToPng } from "../../studio/src/png-export.ts";
import { createZipFromBlobs } from "../../studio/src/zip-export.ts";

// Import templates as raw SVG strings
import scoutingReportSvg from "../../../fixtures/templates/scouting-report.svg?raw";
import shaderCardSvg from "../../../fixtures/templates/shader-card.svg?raw";
import gameAchievementSvg from "../../../fixtures/templates/game-achievement.svg?raw";
import profileHudSvg from "../../../fixtures/templates/profile-hud.svg?raw";
import matchCardSvg from "../../../fixtures/templates/match-card.svg?raw";

// ── Template registry ──────────────────────────────────────
const TEMPLATES: Record<string, { svg: string; width: number; height: number; shader?: boolean }> = {
  "scouting-report":  { svg: scoutingReportSvg, width: 400, height: 560 },
  "shader-card":      { svg: shaderCardSvg, width: 1080, height: 1080, shader: true },
  "game-achievement": { svg: gameAchievementSvg, width: 480, height: 280 },
  "profile-hud":      { svg: profileHudSvg, width: 480, height: 320 },
  "match-card":       { svg: matchCardSvg, width: 1080, height: 480 },
};

let activeTemplate = "scouting-report";
let lastBlobs: Blob[] = [];
let lastBlobUrls: string[] = [];
let isGenerating = false;

// ── DOM refs ───────────────────────────────────────────────
const btnGenerate = document.getElementById("btn-generate") as HTMLButtonElement;
const btnDownload = document.getElementById("btn-download") as HTMLButtonElement;
const gpuBadgeEl = document.getElementById("gpu-badge")!;
const progressContainer = document.getElementById("progress-container")!;
const progressFill = document.getElementById("progress-fill")!;
const progressLabel = document.getElementById("progress-label")!;
const statsBar = document.getElementById("stats-bar")!;
const statCount = document.getElementById("stat-count")!;
const statTime = document.getElementById("stat-time")!;
const statSpeed = document.getElementById("stat-speed")!;
const statBackend = document.getElementById("stat-backend")!;
const cardGrid = document.getElementById("card-grid")!;
const emptyState = document.getElementById("empty-state")!;
const statusText = document.getElementById("status-text")!;
const toastEl = document.getElementById("toast")!;

// Lightbox refs
const lightbox = document.getElementById("lightbox")!;
const lightboxImg = document.getElementById("lightbox-img") as HTMLImageElement;
const lightboxInfo = document.getElementById("lightbox-info")!;
const lightboxClose = document.getElementById("lightbox-close")!;
const lightboxPrev = document.getElementById("lightbox-prev")!;
const lightboxNext = document.getElementById("lightbox-next")!;

let lightboxIndex = 0;
let lightboxTotal = 0;

function showToast(msg: string) {
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  setTimeout(() => toastEl.classList.remove("show"), 3000);
}

// ── Helpers ────────────────────────────────────────────────
function rand(min: number, max: number) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function jitter(base: number, range: number, min: number, max: number) {
  return Math.max(min, Math.min(max, base + rand(-range, range)));
}
function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }

// ══════════════════════════════════════════════════════════════
// ── CURATED DATA POOLS (from studio's sample data) ──────────
// ══════════════════════════════════════════════════════════════

// ── Scouting Report ────────────────────────────────────────
interface ScoutingTier {
  tier: string;
  color_a: string;
  color_b: string;
  color_c: string;
  overallMin: number;
  overallMax: number;
  weight: number;
}

const SCOUTING_TIERS: ScoutingTier[] = [
  { tier: "GOLD",              color_a: "#d4a843", color_b: "#b8942f", color_c: "#8a6d1f", overallMin: 75, overallMax: 84, weight: 20 },
  { tier: "RARE GOLD",         color_a: "#d4a843", color_b: "#c49b38", color_c: "#9a7a28", overallMin: 82, overallMax: 87, weight: 18 },
  { tier: "FUTURE STARS",      color_a: "#a855f7", color_b: "#7c3aed", color_c: "#3b1f6e", overallMin: 85, overallMax: 89, weight: 18 },
  { tier: "TEAM OF THE YEAR",  color_a: "#3b82f6", color_b: "#1d4ed8", color_c: "#1e3a5f", overallMin: 88, overallMax: 93, weight: 16 },
  { tier: "ICON",              color_a: "#d4a843", color_b: "#c49b38", color_c: "#a07d2a", overallMin: 90, overallMax: 96, weight: 10 },
  { tier: "SILVER",            color_a: "#94a3b8", color_b: "#64748b", color_c: "#334155", overallMin: 65, overallMax: 74, weight: 12 },
  { tier: "BRONZE",            color_a: "#cd7f32", color_b: "#8b5e3c", color_c: "#5a3a1f", overallMin: 55, overallMax: 64, weight: 6 },
];

const SCOUTING_NAMES = [
  { name: "MARCUS VALENCIA", nationality: "SPAIN" },
  { name: "YUKI NAKAMURA", nationality: "JAPAN" },
  { name: "KOFI MENSAH", nationality: "GHANA" },
  { name: "ELENA PETROVA", nationality: "RUSSIA" },
  { name: "LUCAS DEMBELE", nationality: "FRANCE" },
  { name: "AISHA OKAFOR", nationality: "NIGERIA" },
  { name: "RAFAEL SANTOS", nationality: "BRAZIL" },
  { name: "FATIMA AL-RASHID", nationality: "SAUDI ARABIA" },
  { name: "JAMES HARTLEY", nationality: "ENGLAND" },
  { name: "SOFIA MARTINEZ", nationality: "ARGENTINA" },
  { name: "KWAME ASANTE", nationality: "CAMEROON" },
  { name: "LENA SCHOLZ", nationality: "GERMANY" },
  { name: "DAICHI TANAKA", nationality: "JAPAN" },
  { name: "CARLOS VEGA", nationality: "MEXICO" },
  { name: "AMARA DIALLO", nationality: "SENEGAL" },
  { name: "MARCO ROSSI", nationality: "ITALY" },
  { name: "INGRID HAALAND", nationality: "NORWAY" },
  { name: "TARIQ HASSAN", nationality: "EGYPT" },
  { name: "PARK JI-WOO", nationality: "SOUTH KOREA" },
  { name: "ANDERS LINDQVIST", nationality: "SWEDEN" },
  { name: "MOUSSA KONATE", nationality: "MALI" },
  { name: "IVAN PETROVIC", nationality: "SERBIA" },
  { name: "DIEGO FUENTES", nationality: "COLOMBIA" },
  { name: "OLUWASEUN ADEYEMI", nationality: "NIGERIA" },
  { name: "HUGO LEFEVRE", nationality: "FRANCE" },
  { name: "KENJI ISHIDA", nationality: "JAPAN" },
  { name: "AYODELE CHUKWU", nationality: "NIGERIA" },
  { name: "PIERRE DUBOIS", nationality: "BELGIUM" },
  { name: "ALEKSEI VOLKOV", nationality: "RUSSIA" },
  { name: "HAMZA BENALI", nationality: "MOROCCO" },
  // 25 new names covering underrepresented regions
  { name: "TOMAS HORVATH", nationality: "HUNGARY" },
  { name: "MATEO GONZALEZ", nationality: "URUGUAY" },
  { name: "ALI REZA HOSSEINI", nationality: "IRAN" },
  { name: "JAKUB NOWAK", nationality: "POLAND" },
  { name: "AHMED MUSTAFA", nationality: "IRAQ" },
  { name: "NGUYEN VAN TOAN", nationality: "VIETNAM" },
  { name: "HIROSHI YAMAMOTO", nationality: "JAPAN" },
  { name: "SAMUEL OTIENO", nationality: "KENYA" },
  { name: "BONGANI NDLOVU", nationality: "SOUTH AFRICA" },
  { name: "ANDRES CIFUENTES", nationality: "CHILE" },
  { name: "LIAM O'BRIEN", nationality: "IRELAND" },
  { name: "WEI ZHANG", nationality: "CHINA" },
  { name: "OMAR KHALIL", nationality: "TUNISIA" },
  { name: "RIKU KORHONEN", nationality: "FINLAND" },
  { name: "DIMITRI PAPADOPOULOS", nationality: "GREECE" },
  { name: "YOUSSEF BOUCHARD", nationality: "CANADA" },
  { name: "ARJUN SHARMA", nationality: "INDIA" },
  { name: "FILIP JOHANSSON", nationality: "DENMARK" },
  { name: "EMIR YILMAZ", nationality: "TURKEY" },
  { name: "GABRIEL ALMEIDA", nationality: "PORTUGAL" },
  { name: "MAMADOU TRAORE", nationality: "IVORY COAST" },
  { name: "NICHOLAS MEYER", nationality: "SWITZERLAND" },
  { name: "RADU POPESCU", nationality: "ROMANIA" },
  { name: "TAKUMI WATANABE", nationality: "JAPAN" },
  { name: "FRASER MCLEOD", nationality: "SCOTLAND" },
];

const SCOUTING_POSITIONS = ["ST", "CM", "CB", "GK", "RW", "LB", "CDM", "CAM", "LW", "RB", "CF", "LM", "RM"];

// Position-aware stat bias: each position emphasizes different stats
const POSITION_BIAS: Record<string, { pac: number; sho: number; pas: number; dri: number; def: number; phy: number }> = {
  GK:  { pac: -10, sho: -15, pas: -5, dri: -15, def: 15, phy: 10 },
  CB:  { pac: -5,  sho: -10, pas: -3, dri: -8,  def: 15, phy: 10 },
  LB:  { pac: 8,   sho: -5,  pas: 3,  dri: 0,   def: 8,  phy: 0 },
  RB:  { pac: 8,   sho: -5,  pas: 3,  dri: 0,   def: 8,  phy: 0 },
  CDM: { pac: -3,  sho: -5,  pas: 5,  dri: -3,  def: 10, phy: 8 },
  CM:  { pac: 0,   sho: 0,   pas: 8,  dri: 3,   def: 3,  phy: 0 },
  CAM: { pac: 3,   sho: 5,   pas: 10, dri: 8,   def: -8, phy: -5 },
  LM:  { pac: 5,   sho: 0,   pas: 5,  dri: 5,   def: -5, phy: -3 },
  RM:  { pac: 5,   sho: 0,   pas: 5,  dri: 5,   def: -5, phy: -3 },
  LW:  { pac: 10,  sho: 5,   pas: 5,  dri: 10,  def: -10, phy: -5 },
  RW:  { pac: 10,  sho: 5,   pas: 5,  dri: 10,  def: -10, phy: -5 },
  ST:  { pac: 10,  sho: 12,  pas: -3, dri: 5,   def: -12, phy: 3 },
  CF:  { pac: 5,   sho: 10,  pas: 3,  dri: 8,   def: -10, phy: 0 },
};

function pickWeightedTier(): ScoutingTier {
  const totalWeight = SCOUTING_TIERS.reduce((s, t) => s + t.weight, 0);
  let r = Math.random() * totalWeight;
  for (const tier of SCOUTING_TIERS) {
    r -= tier.weight;
    if (r <= 0) return tier;
  }
  return SCOUTING_TIERS[0];
}

function generateScoutingData(count: number): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  for (let i = 0; i < count; i++) {
    const tier = pickWeightedTier();
    const entry = SCOUTING_NAMES[i % SCOUTING_NAMES.length];
    const overall = rand(tier.overallMin, tier.overallMax);
    const position = SCOUTING_POSITIONS[i % SCOUTING_POSITIONS.length];
    const bias = POSITION_BIAS[position] || { pac: 0, sho: 0, pas: 0, dri: 0, def: 0, phy: 0 };

    const statBase = Math.round(overall * 0.85);
    rows.push({
      overall: String(overall),
      position,
      name: entry.name,
      nationality: entry.nationality,
      pac: clamp(jitter(statBase + bias.pac, 8, 25, 99), 25, 99),
      sho: clamp(jitter(statBase + bias.sho, 8, 20, 99), 20, 99),
      pas: clamp(jitter(statBase + bias.pas, 8, 30, 99), 30, 99),
      dri: clamp(jitter(statBase + bias.dri, 8, 25, 99), 25, 99),
      def_stat: clamp(jitter(statBase + bias.def, 8, 20, 99), 20, 99),
      phy: clamp(jitter(statBase + bias.phy, 8, 30, 99), 30, 99),
      tier: tier.tier,
      color_a: tier.color_a,
      color_b: tier.color_b,
      color_c: tier.color_c,
    });
  }
  return rows;
}

// ── Shader Card ────────────────────────────────────────────
const SHADER_POOL = [
  { title: "NEBULA",  subtitle: "Deep space generative art",     pattern_label: "PLASMA SHADER", render_info: "WGSL · 1080px · 60fps",        color1: "#6b21a8", color2: "#ec4899", pattern: "plasma" },
  { title: "FLARE",   subtitle: "Captured in code",              pattern_label: "SIMPLEX NOISE", render_info: "WGSL · 1080px · 5 octaves",    color1: "#f59e0b", color2: "#ef4444", pattern: "noise" },
  { title: "ABYSS",   subtitle: "Algorithmic depths",            pattern_label: "VORONOI CELLS", render_info: "WGSL · 1080px · 9 cells",      color1: "#0891b2", color2: "#064e3b", pattern: "voronoi" },
  { title: "AURORA",  subtitle: "Northern lights, computed",     pattern_label: "GRADIENT FLOW", render_info: "WGSL · 1080px · FBM displaced", color1: "#22c55e", color2: "#3b82f6", pattern: "gradient" },
  { title: "MAGMA",   subtitle: "Subsurface luminance",          pattern_label: "PLASMA SHADER", render_info: "WGSL · 1080px · 4 harmonics",  color1: "#dc2626", color2: "#f97316", pattern: "plasma" },
  { title: "TUNDRA",  subtitle: "Crystalline static",            pattern_label: "SIMPLEX NOISE", render_info: "WGSL · 1080px · high freq",    color1: "#94a3b8", color2: "#1e3a5f", pattern: "noise" },
  { title: "ORION",   subtitle: "Raymarched celestial body",     pattern_label: "SPHERE SDF",    render_info: "WGSL · 1080px · 48 steps",     color1: "#7c3aed", color2: "#0f172a", pattern: "sphere" },
  { title: "CUMULUS", subtitle: "Volumetric atmospheric fog",    pattern_label: "CLOUD VOLUME",  render_info: "WGSL · 1080px · 32 steps",     color1: "#cbd5e1", color2: "#1e3a5f", pattern: "clouds" },
  { title: "DIVINE",  subtitle: "Radial light from the heavens", pattern_label: "GOD RAYS",      render_info: "WGSL · 1080px · 16 samples",   color1: "#f59e0b", color2: "#1c1917", pattern: "godrays" },
];

function generateShaderData(count: number): (Record<string, unknown> & { _seed: number; _pattern: string })[] {
  const rows: (Record<string, unknown> & { _seed: number; _pattern: string })[] = [];
  const usedSeeds = new Set<number>();

  for (let i = 0; i < count; i++) {
    const entry = SHADER_POOL[i % SHADER_POOL.length];
    let seed: number;
    do { seed = rand(1, 99999); } while (usedSeeds.has(seed));
    usedSeeds.add(seed);

    rows.push({
      title: entry.title,
      subtitle: entry.subtitle,
      pattern_label: entry.pattern_label,
      render_info: entry.render_info,
      seed_info: `SEED: ${seed}`,
      params_line: `COLOR_A: ${entry.color1.toUpperCase()} · COLOR_B: ${entry.color2.toUpperCase()}`,
      color1: entry.color1,
      color2: entry.color2,
      shader_bg: "",
      _seed: seed,
      _pattern: entry.pattern,
    });
  }
  return rows;
}

// ── Game Achievement ───────────────────────────────────────
const ACHIEVEMENT_POOL = [
  { name: "DRAGON SLAYER",  description: "Defeat the ancient dragon in under 2 minutes",   xp: "+2500 XP", rarity: "LEGENDARY" },
  { name: "SPEED DEMON",    description: "Complete any level in under 30 seconds",          xp: "+1500 XP", rarity: "EPIC" },
  { name: "SHARPSHOOTER",   description: "Land 500 headshots in multiplayer matches",       xp: "+800 XP",  rarity: "RARE" },
  { name: "FIRST BLOOD",    description: "Get the first elimination in a match",            xp: "+100 XP",  rarity: "COMMON" },
  { name: "UNTOUCHABLE",    description: "Win a match without taking any damage",           xp: "+3000 XP", rarity: "LEGENDARY" },
  { name: "TEAM PLAYER",    description: "Revive 100 teammates in co-op missions",          xp: "+600 XP",  rarity: "RARE" },
  { name: "PERFECT RUN",    description: "Complete the campaign without dying once",        xp: "+5000 XP", rarity: "LEGENDARY" },
  { name: "TREASURE HUNTER", description: "Find all 200 hidden collectibles",               xp: "+1200 XP", rarity: "EPIC" },
  { name: "MARATHON",       description: "Play for 100 hours total",                        xp: "+400 XP",  rarity: "COMMON" },
  { name: "TRIPLE KILL",    description: "Eliminate 3 enemies within 5 seconds",            xp: "+750 XP",  rarity: "RARE" },
  { name: "GHOST",          description: "Complete a stealth mission without being detected", xp: "+2000 XP", rarity: "EPIC" },
  { name: "ARCHITECT",      description: "Build 50 structures in creative mode",            xp: "+350 XP",  rarity: "COMMON" },
  { name: "NEMESIS",        description: "Defeat every boss on the highest difficulty",     xp: "+4000 XP", rarity: "LEGENDARY" },
  { name: "EXPLORER",       description: "Discover all 30 hidden areas on the map",         xp: "+900 XP",  rarity: "RARE" },
  { name: "SNIPER ELITE",   description: "Score a 500m headshot in any match",              xp: "+1800 XP", rarity: "EPIC" },
  { name: "IRONCLAD",       description: "Block 1000 incoming attacks with a shield",       xp: "+550 XP",  rarity: "RARE" },
  { name: "CHAMPION",       description: "Win 50 ranked matches in a row",                  xp: "+6000 XP", rarity: "LEGENDARY" },
  { name: "MEDIC",          description: "Heal teammates for 50,000 total HP",              xp: "+700 XP",  rarity: "RARE" },
  { name: "DAREDEVIL",      description: "Survive a fall from maximum height",              xp: "+200 XP",  rarity: "COMMON" },
  { name: "NIGHT OWL",      description: "Complete 10 missions during nighttime",           xp: "+450 XP",  rarity: "COMMON" },
  { name: "BERSERKER",      description: "Deal 10,000 damage in a single match",            xp: "+1600 XP", rarity: "EPIC" },
  { name: "PACIFIST",       description: "Complete a level without attacking anyone",       xp: "+2200 XP", rarity: "LEGENDARY" },
  { name: "COLLECTOR",      description: "Own every weapon skin in the game",               xp: "+3500 XP", rarity: "EPIC" },
  { name: "LAST STAND",     description: "Win a 1v5 clutch round",                          xp: "+2800 XP", rarity: "LEGENDARY" },
  // 26 new achievements across strategy, survival, racing, puzzle, MMO, horror, RPG
  { name: "GRAND STRATEGIST", description: "Win a 4X campaign on emperor difficulty",       xp: "+3200 XP", rarity: "LEGENDARY" },
  { name: "CASTAWAY",       description: "Survive 30 in-game days with no shelter",         xp: "+1100 XP", rarity: "EPIC" },
  { name: "POLE POSITION",  description: "Qualify first in 20 consecutive races",           xp: "+900 XP",  rarity: "RARE" },
  { name: "PUZZLE MASTER",  description: "Solve 100 puzzles without using hints",           xp: "+800 XP",  rarity: "RARE" },
  { name: "GUILD LEADER",   description: "Lead a guild to server-first raid clear",         xp: "+4500 XP", rarity: "LEGENDARY" },
  { name: "LIGHTS OUT",     description: "Complete a horror chapter without the flashlight", xp: "+1400 XP", rarity: "EPIC" },
  { name: "DUNGEON CRAWLER", description: "Clear 50 randomly generated dungeon floors",     xp: "+1000 XP", rarity: "RARE" },
  { name: "DRIFT KING",     description: "Maintain a 10-second continuous drift",           xp: "+650 XP",  rarity: "RARE" },
  { name: "SURVIVALIST",    description: "Craft every survival tool in the game",           xp: "+500 XP",  rarity: "COMMON" },
  { name: "MIND BENDER",    description: "Solve the final meta-puzzle in under 60 seconds", xp: "+2400 XP", rarity: "EPIC" },
  { name: "RAID BOSS",      description: "Deal the killing blow in 10 world boss fights",   xp: "+1300 XP", rarity: "EPIC" },
  { name: "NIGHTMARE MODE", description: "Beat the game on nightmare difficulty",           xp: "+3800 XP", rarity: "LEGENDARY" },
  { name: "CONVOY",         description: "Complete 25 escort missions without losing cargo", xp: "+750 XP",  rarity: "RARE" },
  { name: "APEX PREDATOR",  description: "Reach the top of the food chain in survival mode", xp: "+1700 XP", rarity: "EPIC" },
  { name: "BOTANIST",       description: "Catalogue all 80 plant species",                  xp: "+300 XP",  rarity: "COMMON" },
  { name: "PITSTOP PRO",    description: "Execute a perfect pit stop under 2 seconds",      xp: "+550 XP",  rarity: "RARE" },
  { name: "ALCHEMIST",      description: "Discover all 40 potion recipes",                  xp: "+600 XP",  rarity: "RARE" },
  { name: "SIEGE MASTER",   description: "Capture 100 control points in PvP",               xp: "+850 XP",  rarity: "RARE" },
  { name: "ECHO CHAMBER",   description: "Find all 12 hidden audio logs in the asylum",     xp: "+1500 XP", rarity: "EPIC" },
  { name: "COMPLETIONIST",  description: "Achieve 100% game completion",                    xp: "+5000 XP", rarity: "LEGENDARY" },
  { name: "UNDERDOG",       description: "Win a match after being down 0-4",                xp: "+1900 XP", rarity: "EPIC" },
  { name: "PATHFINDER",     description: "Unlock all fast-travel points on every map",       xp: "+400 XP",  rarity: "COMMON" },
  { name: "DEMOLITIONS",    description: "Destroy 500 destructible objects in one session",  xp: "+350 XP",  rarity: "COMMON" },
  { name: "CHRONO SHIFT",   description: "Finish a time-trial with less than 0.1s margin",  xp: "+2100 XP", rarity: "EPIC" },
  { name: "IRON STOMACH",   description: "Eat every consumable item at least once",          xp: "+250 XP",  rarity: "COMMON" },
  { name: "SILENT BLADE",   description: "Assassinate 50 targets without alerting guards",   xp: "+1000 XP", rarity: "RARE" },
];

const RARITY_COLORS: Record<string, { color_a: string; color_b: string; icon_bg: string }> = {
  LEGENDARY: { color_a: "#f59e0b", color_b: "#451a03", icon_bg: "#1a1408" },
  EPIC:      { color_a: "#a855f7", color_b: "#2e1065", icon_bg: "#1a0e2e" },
  RARE:      { color_a: "#3b82f6", color_b: "#172554", icon_bg: "#0c1429" },
  COMMON:    { color_a: "#6b7280", color_b: "#1f2937", icon_bg: "#111318" },
};

const ACHIEVEMENT_DATES = [
  "MAR 21, 2026", "MAR 14, 2026", "MAR 5, 2026", "FEB 22, 2026",
  "FEB 10, 2026", "JAN 28, 2026", "JAN 15, 2026", "DEC 30, 2025",
  "DEC 18, 2025", "NOV 25, 2025", "NOV 8, 2025", "OCT 20, 2025",
  "IN PROGRESS",
];

function generateAchievementData(count: number): Record<string, unknown>[] {
  // Build pool with controlled progress distribution:
  // 40% complete, 25% near-complete (75-95%), 20% mid (30-60%), 15% starting (5-20%)
  const fullPool = ACHIEVEMENT_POOL.map((a, i) => {
    const colors = RARITY_COLORS[a.rarity];
    let pct: number;
    const r = i / ACHIEVEMENT_POOL.length;
    if (r < 0.40) pct = 100;
    else if (r < 0.65) pct = rand(75, 95);
    else if (r < 0.85) pct = rand(30, 60);
    else pct = rand(5, 20);

    return {
      ...a,
      ...colors,
      progress: `${pct}%`,
      progress_width: Math.round(pct * 2.8),
    };
  });

  const rows: Record<string, unknown>[] = [];
  for (let i = 0; i < count; i++) {
    const entry = fullPool[i % fullPool.length];
    const date = entry.progress === "100%"
      ? ACHIEVEMENT_DATES[i % (ACHIEVEMENT_DATES.length - 1)]
      : "IN PROGRESS";
    rows.push({
      ...entry,
      date,
    });
  }
  return rows;
}

// ── Profile HUD ────────────────────────────────────────────
const HUD_POOL = [
  { username: "SHADOWVEX",   level: "LVL 247", xp_text: "18,450 / 25,000 XP", xp_width: 195, wins: "1,247", kd: "2.34", winrate: "67.2%", rank: "RADIANT",   status: "IN GAME", color_a: "#8b5cf6", color_b: "#1e1b4b", status_color: "#22c55e", rank_color: "#ff4655" },
  { username: "NEONKNIGHT",  level: "LVL 182", xp_text: "12,800 / 20,000 XP", xp_width: 166, wins: "856",   kd: "1.87", winrate: "58.4%", rank: "DIAMOND",   status: "ONLINE",  color_a: "#06b6d4", color_b: "#042f2e", status_color: "#22c55e", rank_color: "#b9f2ff" },
  { username: "GHOSTPIXEL",  level: "LVL 310", xp_text: "24,100 / 30,000 XP", xp_width: 208, wins: "2,103", kd: "3.12", winrate: "72.8%", rank: "IMMORTAL",  status: "IN GAME", color_a: "#ef4444", color_b: "#450a0a", status_color: "#22c55e", rank_color: "#ff4655" },
  { username: "ZEROPING",    level: "LVL 95",  xp_text: "4,200 / 10,000 XP",  xp_width: 109, wins: "312",   kd: "1.23", winrate: "49.1%", rank: "PLATINUM",  status: "AWAY",    color_a: "#f59e0b", color_b: "#451a03", status_color: "#f59e0b", rank_color: "#22d3ee" },
  { username: "COSMICFADE",  level: "LVL 420", xp_text: "29,500 / 35,000 XP", xp_width: 219, wins: "3,891", kd: "4.56", winrate: "78.3%", rank: "CHAMPION",  status: "ONLINE",  color_a: "#ec4899", color_b: "#500724", status_color: "#22c55e", rank_color: "#fbbf24" },
  { username: "BYTESTORM",   level: "LVL 15",  xp_text: "800 / 2,000 XP",     xp_width: 104, wins: "23",    kd: "0.67", winrate: "34.8%", rank: "GOLD",      status: "ONLINE",  color_a: "#22c55e", color_b: "#022c22", status_color: "#22c55e", rank_color: "#fbbf24" },
];

const EXTRA_USERNAMES = [
  "VOIDWALKER", "PIXELRIFT", "STARFURY", "IRONSIGHT", "DARKECHO",
  "NOVABURN", "CODEBREAKER", "HEXPROOF", "SKULLCAP", "LUNARFLUX",
  "THUNDERBYTE", "GLITCHWAVE", "ACIDRAIN", "STEELSOUL", "NIGHTHAWK",
  "OVERCLOCKED", "CRYPTOFIRE", "DEADZONE", "EMBERPULSE", "FROSTBITE",
  "PHANTOMGRID", "NULLPOINT", "BLAZECORE", "QUANTUMLAG",
  // 30 new gamer tags
  "VOLTEDGE", "PLASMARIFT", "DARKMATTER", "ZENITHPULSE", "WARPFIELD",
  "IRONFORGE", "NEBULACLAW", "CYBERVOID", "SHELLSHOCK", "RAZORWAVE",
  "CHROMABURN", "SPECTRUMX", "VENOMSTRIKE", "SOLARBURST", "TITANFALL",
  "QUICKSCOPE", "NEONFLASH", "SHADOWRUN", "RAGEMODE", "STATICNOVA",
  "HYPERDRIFT", "COLDFRONT", "TORCHLIGHT", "SILENTGHOST", "PYROSTORM",
  "AQUAFLUX", "BLITZKRIEG", "DREAMCORE", "ECHOVAULT", "OMEGABYTE",
];

const HUD_RANKS = ["RADIANT", "IMMORTAL", "DIAMOND", "CHAMPION", "PLATINUM", "GOLD", "SILVER", "BRONZE"];
const HUD_STATUSES = ["ONLINE", "IN GAME", "AWAY", "IN QUEUE"];
const HUD_COLORS: { color_a: string; color_b: string }[] = [
  { color_a: "#8b5cf6", color_b: "#1e1b4b" },
  { color_a: "#06b6d4", color_b: "#042f2e" },
  { color_a: "#ef4444", color_b: "#450a0a" },
  { color_a: "#f59e0b", color_b: "#451a03" },
  { color_a: "#ec4899", color_b: "#500724" },
  { color_a: "#22c55e", color_b: "#022c22" },
  { color_a: "#3b82f6", color_b: "#172554" },
  { color_a: "#f97316", color_b: "#431407" },
  // 2 new palettes: teal + vivid purple
  { color_a: "#14b8a6", color_b: "#042f2e" },
  { color_a: "#c026d3", color_b: "#4a044e" },
];
const HUD_STATUS_COLORS: Record<string, string> = {
  ONLINE: "#22c55e", "IN GAME": "#22c55e", AWAY: "#f59e0b", "IN QUEUE": "#3b82f6",
};
const HUD_RANK_COLORS: Record<string, string> = {
  RADIANT: "#ff4655", IMMORTAL: "#ff4655", DIAMOND: "#b9f2ff", CHAMPION: "#fbbf24",
  PLATINUM: "#22d3ee", GOLD: "#fbbf24", SILVER: "#94a3b8", BRONZE: "#cd7f32",
};

function generateHudData(count: number): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  const allUsernames = [...HUD_POOL.map(h => h.username), ...EXTRA_USERNAMES];

  // Shuffle username assignment for visual freshness
  const shuffled = [...allUsernames];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  for (let i = 0; i < count; i++) {
    if (i < HUD_POOL.length) {
      rows.push({ ...HUD_POOL[i] });
    } else {
      const username = shuffled[i % shuffled.length];
      const lvl = rand(5, 500);
      const maxXp = Math.round(lvl * 80 + 1000);
      const curXp = rand(0, maxXp);
      const xpWidth = Math.round((curXp / maxXp) * 260);
      const rank = HUD_RANKS[rand(0, HUD_RANKS.length - 1)];
      const status = HUD_STATUSES[rand(0, HUD_STATUSES.length - 1)];
      const colors = HUD_COLORS[i % HUD_COLORS.length];
      const wins = rand(10, 5000);
      const kd = (Math.random() * 5 + 0.3).toFixed(2);
      const winrate = (Math.random() * 50 + 25).toFixed(1) + "%";

      rows.push({
        username,
        level: `LVL ${lvl}`,
        xp_text: `${curXp.toLocaleString()} / ${maxXp.toLocaleString()} XP`,
        xp_width: clamp(xpWidth, 10, 250),
        wins: wins.toLocaleString(),
        kd,
        winrate,
        rank,
        status,
        ...colors,
        status_color: HUD_STATUS_COLORS[status] || "#22c55e",
        rank_color: HUD_RANK_COLORS[rank] || "#fbbf24",
      });
    }
  }
  return rows;
}

// ── Match Card ────────────────────────────────────────────
interface MatchEntry {
  team_a: string;
  team_b: string;
  score_a: string;
  score_b: string;
  tournament: string;
  stage: string;
  game: string;
  date: string;
  broadcast: string;
  color_a: string;
  color_b: string;
  accent: string;
}

const MATCH_POOL: MatchEntry[] = [
  // VALORANT (5)
  { team_a: "CLOUD9",       team_b: "FNATIC",        score_a: "3", score_b: "1", tournament: "VALORANT CHAMPIONS TOUR", stage: "GRAND FINAL",    game: "VALORANT",    date: "MARCH 21, 2026", broadcast: "TWITCH · YOUTUBE", color_a: "#3b82f6", color_b: "#ef4444", accent: "#f59e0b" },
  { team_a: "SENTINELS",    team_b: "LOUD",          score_a: "2", score_b: "3", tournament: "VCT MASTERS TOKYO",       stage: "UPPER FINAL",    game: "VALORANT",    date: "MARCH 15, 2026", broadcast: "TWITCH · YOUTUBE", color_a: "#dc2626", color_b: "#22c55e", accent: "#ec4899" },
  { team_a: "DRX",          team_b: "PAPER REX",     score_a: "2", score_b: "1", tournament: "VCT PACIFIC LEAGUE",      stage: "WEEK 6",         game: "VALORANT",    date: "MARCH 10, 2026", broadcast: "TWITCH",           color_a: "#6366f1", color_b: "#f97316", accent: "#22d3ee" },
  { team_a: "NAVI",         team_b: "FPX",           score_a: "0", score_b: "2", tournament: "VCT EMEA LEAGUE",         stage: "PLAYOFFS R1",    game: "VALORANT",    date: "FEB 28, 2026",   broadcast: "TWITCH · YOUTUBE", color_a: "#fbbf24", color_b: "#ef4444", accent: "#a855f7" },
  { team_a: "100 THIEVES",  team_b: "EVIL GENIUSES", score_a: "2", score_b: "0", tournament: "VCT AMERICAS LEAGUE",     stage: "WEEK 3",         game: "VALORANT",    date: "FEB 20, 2026",   broadcast: "TWITCH",           color_a: "#dc2626", color_b: "#3b82f6", accent: "#f59e0b" },
  // League of Legends (5)
  { team_a: "T1",           team_b: "GEN.G",         score_a: "3", score_b: "2", tournament: "LCK SPRING 2026",         stage: "GRAND FINAL",    game: "LEAGUE OF LEGENDS", date: "MARCH 18, 2026", broadcast: "TWITCH · AFK",  color_a: "#ef4444", color_b: "#fbbf24", accent: "#6366f1" },
  { team_a: "G2 ESPORTS",   team_b: "FNATIC",        score_a: "3", score_b: "1", tournament: "LEC WINTER 2026",         stage: "SEMI-FINAL",     game: "LEAGUE OF LEGENDS", date: "MARCH 12, 2026", broadcast: "TWITCH · YOUTUBE", color_a: "#1e1e2e", color_b: "#f97316", accent: "#22c55e" },
  { team_a: "JD GAMING",    team_b: "BILIBILI",      score_a: "2", score_b: "0", tournament: "LPL SPRING 2026",         stage: "WEEK 8",         game: "LEAGUE OF LEGENDS", date: "MARCH 5, 2026",  broadcast: "HUYA · BILIBILI", color_a: "#dc2626", color_b: "#22d3ee", accent: "#f59e0b" },
  { team_a: "CLOUD9",       team_b: "FLYQUEST",      score_a: "1", score_b: "3", tournament: "LCS SPRING 2026",         stage: "UPPER BRACKET",  game: "LEAGUE OF LEGENDS", date: "FEB 22, 2026",   broadcast: "TWITCH",          color_a: "#3b82f6", color_b: "#22c55e", accent: "#ec4899" },
  { team_a: "DK",           team_b: "KT ROLSTER",    score_a: "2", score_b: "1", tournament: "LCK SPRING 2026",         stage: "WEEK 5",         game: "LEAGUE OF LEGENDS", date: "FEB 15, 2026",   broadcast: "TWITCH · AFK",    color_a: "#0ea5e9", color_b: "#ef4444", accent: "#fbbf24" },
  // CS2 (5)
  { team_a: "NATUS VINCERE", team_b: "FAZE CLAN",    score_a: "2", score_b: "1", tournament: "IEM KATOWICE 2026",       stage: "GRAND FINAL",    game: "CS2",         date: "MARCH 16, 2026", broadcast: "TWITCH · YOUTUBE", color_a: "#fbbf24", color_b: "#ef4444", accent: "#22c55e" },
  { team_a: "VITALITY",     team_b: "G2 ESPORTS",    score_a: "2", score_b: "0", tournament: "BLAST PREMIER SPRING",    stage: "FINAL",          game: "CS2",         date: "MARCH 9, 2026",  broadcast: "TWITCH",           color_a: "#fbbf24", color_b: "#1e1e2e", accent: "#3b82f6" },
  { team_a: "MOUZ",         team_b: "SPIRIT",        score_a: "1", score_b: "2", tournament: "ESL PRO LEAGUE S21",      stage: "QUARTER-FINAL",  game: "CS2",         date: "FEB 26, 2026",   broadcast: "TWITCH · YOUTUBE", color_a: "#ef4444", color_b: "#6366f1", accent: "#f59e0b" },
  { team_a: "HEROIC",       team_b: "FURIA",         score_a: "2", score_b: "1", tournament: "PGL MAJOR QUALIFIER",     stage: "ELIMINATION",    game: "CS2",         date: "FEB 12, 2026",   broadcast: "TWITCH",           color_a: "#fbbf24", color_b: "#22c55e", accent: "#ec4899" },
  { team_a: "ASTRALIS",     team_b: "ETERNAL FIRE",  score_a: "0", score_b: "2", tournament: "BLAST PREMIER GROUPS",    stage: "GROUP A",        game: "CS2",         date: "JAN 30, 2026",   broadcast: "TWITCH · YOUTUBE", color_a: "#dc2626", color_b: "#f97316", accent: "#6366f1" },
  // Overwatch (5)
  { team_a: "SEOUL DYNASTY", team_b: "SAN FRAN SHOCK", score_a: "4", score_b: "3", tournament: "OWL GRAND FINALS 2026",  stage: "GRAND FINAL",    game: "OVERWATCH 2", date: "MARCH 20, 2026", broadcast: "TWITCH · YOUTUBE", color_a: "#fbbf24", color_b: "#f97316", accent: "#6366f1" },
  { team_a: "DALLAS FUEL",  team_b: "HOUSTON OUTLAWS", score_a: "3", score_b: "1", tournament: "OWL SPRING STAGE",       stage: "TEXAS DERBY",    game: "OVERWATCH 2", date: "MARCH 8, 2026",  broadcast: "TWITCH",           color_a: "#1e3a5f", color_b: "#22c55e", accent: "#ef4444" },
  { team_a: "LONDON SPITFIRE", team_b: "PARIS ETERNAL", score_a: "1", score_b: "3", tournament: "OWL SPRING STAGE",      stage: "WEEK 4",         game: "OVERWATCH 2", date: "FEB 24, 2026",   broadcast: "TWITCH · YOUTUBE", color_a: "#0ea5e9", color_b: "#1e1e2e", accent: "#fbbf24" },
  { team_a: "SHANGHAI DRAGONS", team_b: "HANGZHOU SPARK", score_a: "3", score_b: "0", tournament: "OWL PACIFIC QUALIFIER", stage: "SEMI-FINAL",    game: "OVERWATCH 2", date: "FEB 14, 2026",   broadcast: "BILIBILI",         color_a: "#dc2626", color_b: "#ec4899", accent: "#f59e0b" },
  { team_a: "ATLANTA REIGN", team_b: "TORONTO DEFIANT", score_a: "3", score_b: "2", tournament: "OWL SPRING STAGE",      stage: "WEEK 2",         game: "OVERWATCH 2", date: "FEB 6, 2026",    broadcast: "TWITCH",           color_a: "#ef4444", color_b: "#6366f1", accent: "#22c55e" },
  // Rocket League (5)
  { team_a: "G2 ESPORTS",   team_b: "TEAM BDS",      score_a: "4", score_b: "2", tournament: "RLCS WORLD CHAMPIONSHIP", stage: "GRAND FINAL",    game: "ROCKET LEAGUE", date: "MARCH 19, 2026", broadcast: "TWITCH · YOUTUBE", color_a: "#1e1e2e", color_b: "#3b82f6", accent: "#f59e0b" },
  { team_a: "GENG MOBIL1",  team_b: "VITALITY",      score_a: "3", score_b: "4", tournament: "RLCS MAJOR 1",            stage: "UPPER FINAL",    game: "ROCKET LEAGUE", date: "MARCH 6, 2026",  broadcast: "TWITCH",           color_a: "#fbbf24", color_b: "#fbbf24", accent: "#ec4899" },
  { team_a: "FURIA",        team_b: "OXYGEN",        score_a: "3", score_b: "1", tournament: "RLCS SAM REGIONAL",       stage: "FINAL",          game: "ROCKET LEAGUE", date: "FEB 18, 2026",   broadcast: "TWITCH · YOUTUBE", color_a: "#22c55e", color_b: "#3b82f6", accent: "#6366f1" },
  { team_a: "FALCONS",      team_b: "KARMINE CORP",  score_a: "4", score_b: "0", tournament: "RLCS MENA OPEN",          stage: "GRAND FINAL",    game: "ROCKET LEAGUE", date: "FEB 8, 2026",    broadcast: "TWITCH",           color_a: "#22d3ee", color_b: "#3b82f6", accent: "#ef4444" },
  { team_a: "NRG",          team_b: "SPACESTATION",  score_a: "2", score_b: "3", tournament: "RLCS NA REGIONAL",        stage: "LOWER FINAL",    game: "ROCKET LEAGUE", date: "JAN 25, 2026",   broadcast: "TWITCH · YOUTUBE", color_a: "#6366f1", color_b: "#fbbf24", accent: "#22c55e" },
];

function generateMatchData(count: number): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  const stages = ["GRAND FINAL", "SEMI-FINAL", "QUARTER-FINAL", "UPPER FINAL", "LOWER FINAL", "GROUP STAGE", "ELIMINATION", "WEEK 1", "WEEK 2", "WEEK 3"];
  const dates = [
    "MARCH 22, 2026", "MARCH 17, 2026", "MARCH 11, 2026", "MARCH 3, 2026",
    "FEB 25, 2026", "FEB 16, 2026", "FEB 7, 2026", "JAN 28, 2026",
    "JAN 18, 2026", "JAN 5, 2026", "DEC 22, 2025", "DEC 10, 2025",
  ];

  // Jitter a hex color slightly
  function jitterColor(hex: string): string {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    const jr = clamp(r + rand(-20, 20), 0, 255);
    const jg = clamp(g + rand(-20, 20), 0, 255);
    const jb = clamp(b + rand(-20, 20), 0, 255);
    return `#${jr.toString(16).padStart(2, "0")}${jg.toString(16).padStart(2, "0")}${jb.toString(16).padStart(2, "0")}`;
  }

  for (let i = 0; i < count; i++) {
    const baseIdx = i % 25;
    const variant = Math.floor(i / 25); // 0..3
    const base = MATCH_POOL[baseIdx];

    let entry: MatchEntry;

    if (variant === 0) {
      // Cards 1-25: unique matchups as-is
      entry = { ...base };
    } else if (variant === 1) {
      // Cards 26-50: same teams, different scores + stages (rematch)
      entry = {
        ...base,
        score_a: String(rand(0, 4)),
        score_b: String(rand(0, 4)),
        stage: stages[rand(0, stages.length - 1)],
        date: dates[rand(0, dates.length - 1)],
      };
    } else if (variant === 2) {
      // Cards 51-75: teams swapped (A↔B), color washes swap, different scores
      entry = {
        ...base,
        team_a: base.team_b,
        team_b: base.team_a,
        color_a: base.color_b,
        color_b: base.color_a,
        score_a: String(rand(0, 4)),
        score_b: String(rand(0, 4)),
        stage: stages[rand(0, stages.length - 1)],
        date: dates[rand(0, dates.length - 1)],
      };
    } else {
      // Cards 76-100: shuffled dates, jittered accent colors, varied stages
      entry = {
        ...base,
        score_a: String(rand(0, 4)),
        score_b: String(rand(0, 4)),
        stage: stages[rand(0, stages.length - 1)],
        date: dates[rand(0, dates.length - 1)],
        accent: jitterColor(base.accent),
      };
    }

    rows.push(entry as unknown as Record<string, unknown>);
  }
  return rows;
}

// ── Generate data for any template ─────────────────────────
function generateDataForTemplate(templateId: string, count: number): Record<string, unknown>[] {
  switch (templateId) {
    case "scouting-report":  return generateScoutingData(count);
    case "shader-card":      return generateShaderData(count);
    case "game-achievement": return generateAchievementData(count);
    case "profile-hud":      return generateHudData(count);
    case "match-card":       return generateMatchData(count);
    default:                 return generateScoutingData(count);
  }
}

// ── GPU backend detection ──────────────────────────────────
async function detectGPU() {
  try {
    await renderShader({
      color1: "#6366f1",
      color2: "#ec4899",
      seed: 1,
      pattern: "plasma",
      width: 16,
      height: 16,
    });
    updateGPUBadge();
  } catch {
    gpuBadgeEl.textContent = "none";
    gpuBadgeEl.className = "gpu-badge none";
  }
}

function updateGPUBadge() {
  const backend = gpuBackend || "none";
  gpuBadgeEl.textContent = backend;
  gpuBadgeEl.className = `gpu-badge ${backend}`;
}

// ── Lightbox ───────────────────────────────────────────────
function openLightbox(index: number) {
  if (!lastBlobUrls.length) return;
  lightboxIndex = index;
  lightboxTotal = lastBlobUrls.length;
  lightboxImg.src = lastBlobUrls[index];
  const templateLabel = document.querySelector(".template-btn.active")?.textContent || activeTemplate;
  lightboxInfo.textContent = `#${index + 1} / ${lightboxTotal}  ·  ${templateLabel}`;
  lightbox.style.display = "flex";
  void lightbox.offsetWidth;
  lightbox.classList.add("open");
}

function closeLightbox() {
  lightbox.classList.remove("open");
  lightbox.style.display = "none";
}

function navigateLightbox(delta: number) {
  const newIndex = (lightboxIndex + delta + lightboxTotal) % lightboxTotal;
  openLightbox(newIndex);
}

lightboxClose.addEventListener("click", closeLightbox);
lightboxPrev.addEventListener("click", (e) => { e.stopPropagation(); navigateLightbox(-1); });
lightboxNext.addEventListener("click", (e) => { e.stopPropagation(); navigateLightbox(1); });
lightbox.addEventListener("click", (e) => {
  if (e.target === lightbox) closeLightbox();
});
document.addEventListener("keydown", (e) => {
  if (!lightbox.classList.contains("open")) return;
  if (e.key === "Escape") closeLightbox();
  if (e.key === "ArrowLeft") navigateLightbox(-1);
  if (e.key === "ArrowRight") navigateLightbox(1);
});

// ── Batch generate ─────────────────────────────────────────
async function generate() {
  if (isGenerating) return;
  isGenerating = true;

  const count = 100;
  const tmpl = TEMPLATES[activeTemplate];
  const rows = generateDataForTemplate(activeTemplate, count);
  const blobs: Blob[] = [];

  // Revoke old URLs
  lastBlobUrls.forEach(u => URL.revokeObjectURL(u));
  lastBlobUrls = [];

  btnGenerate.disabled = true;
  btnDownload.disabled = true;
  progressContainer.classList.add("visible");
  statsBar.classList.remove("visible");
  cardGrid.innerHTML = "";
  cardGrid.style.display = "grid";
  emptyState.style.display = "none";

  // Adjust grid columns based on template aspect ratio
  const aspect = tmpl.width / tmpl.height;
  if (aspect > 1.8) {
    // Ultra-wide cards (match-card 1080×480 = 2.25)
    cardGrid.style.gridTemplateColumns = "repeat(auto-fill, minmax(280px, 1fr))";
  } else if (aspect > 1.3) {
    // Wide cards (achievement, profile-hud)
    cardGrid.style.gridTemplateColumns = "repeat(auto-fill, minmax(220px, 1fr))";
  } else if (aspect > 0.9) {
    // Square cards (shader-card)
    cardGrid.style.gridTemplateColumns = "repeat(auto-fill, minmax(180px, 1fr))";
  } else {
    // Tall cards (scouting-report)
    cardGrid.style.gridTemplateColumns = "repeat(auto-fill, minmax(140px, 1fr))";
  }

  const t0 = performance.now();

  for (let i = 0; i < count; i++) {
    let row = rows[i];

    // Shader preprocess: render GPU texture for shader-based templates
    if (tmpl.shader) {
      try {
        const shaderRow = row as Record<string, unknown> & { _seed?: number; _pattern?: string };
        const dataUri = await renderShader({
          color1: (shaderRow.color1 as string) || "#6366f1",
          color2: (shaderRow.color2 as string) || "#ec4899",
          seed: shaderRow._seed ?? Math.random() * 100,
          pattern: shaderRow._pattern ?? "plasma",
          width: tmpl.width,
          height: tmpl.height,
        });
        row = { ...row, shader_bg: dataUri };
      } catch (e) {
        console.warn("Shader render failed for card", i, e);
      }
    }

    // Resolve template bindings
    const resolvedSvg = resolveTemplateSvg(tmpl.svg, row as Record<string, unknown>, undefined, `c${i}`);

    // Render to PNG (scale=1 for speed in preview)
    const blob = await svgToPng(resolvedSvg, tmpl.width, tmpl.height, 1);
    blobs.push(blob);

    // Create object URL
    const url = URL.createObjectURL(blob);
    lastBlobUrls.push(url);

    // Add to grid preview
    const cell = document.createElement("div");
    cell.className = "card-cell";
    cell.style.aspectRatio = `${tmpl.width} / ${tmpl.height}`;
    cell.dataset.index = String(i);
    const img = document.createElement("img");
    img.src = url;
    img.loading = "lazy";
    cell.appendChild(img);
    const idx = document.createElement("span");
    idx.className = "card-index";
    idx.textContent = `#${i + 1}`;
    cell.appendChild(idx);
    cell.addEventListener("click", () => openLightbox(Number(cell.dataset.index)));
    cardGrid.appendChild(cell);

    // Update progress
    const pct = Math.round(((i + 1) / count) * 100);
    progressFill.style.width = `${pct}%`;
    progressLabel.textContent = `${i + 1} / ${count}`;

    // Yield every 4 cards
    if (i % 4 === 3) {
      await new Promise(r => requestAnimationFrame(r));
    }
  }

  const elapsed = performance.now() - t0;
  lastBlobs = blobs;

  // Show stats
  updateGPUBadge();
  statCount.textContent = `${count}`;
  statTime.textContent = `${(elapsed / 1000).toFixed(1)}s`;
  statSpeed.textContent = `${Math.round(count / (elapsed / 1000))} cards/sec`;
  statBackend.textContent = gpuBackend || "canvas";
  statsBar.classList.add("visible");
  progressContainer.classList.remove("visible");

  btnGenerate.disabled = false;
  btnDownload.disabled = false;
  isGenerating = false;

  statusText.textContent = `Generated ${count} cards in ${(elapsed / 1000).toFixed(1)}s`;
  showToast(`${count} cards rendered at ${Math.round(count / (elapsed / 1000))} cards/sec`);
}

// ── ZIP download ───────────────────────────────────────────
async function downloadZip() {
  if (!lastBlobs.length) return;
  btnDownload.disabled = true;
  statusText.textContent = "Creating ZIP...";

  const items = lastBlobs.map((blob, i) => ({
    name: `card-${String(i + 1).padStart(3, "0")}.png`,
    blob,
  }));

  const zipBlob = await createZipFromBlobs(items);
  const url = URL.createObjectURL(zipBlob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `svg-os-cards-${activeTemplate}.zip`;
  a.click();
  URL.revokeObjectURL(url);

  btnDownload.disabled = false;
  statusText.textContent = "ZIP downloaded";
  showToast(`Downloaded ${lastBlobs.length} cards as ZIP`);
}

// ── Template switching ─────────────────────────────────────
document.querySelectorAll(".template-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelector(".template-btn.active")?.classList.remove("active");
    btn.classList.add("active");
    activeTemplate = (btn as HTMLElement).dataset.template!;
    cardGrid.innerHTML = "";
    lastBlobs = [];
    lastBlobUrls.forEach(u => URL.revokeObjectURL(u));
    lastBlobUrls = [];
    btnDownload.disabled = true;
    statsBar.classList.remove("visible");
  });
});

// ── Events ─────────────────────────────────────────────────
btnGenerate.addEventListener("click", generate);
btnDownload.addEventListener("click", downloadZip);

// ── Init ───────────────────────────────────────────────────
async function init() {
  await detectGPU();
  btnGenerate.disabled = false;
  statusText.textContent = "Ready — GPU backend: " + (gpuBackend || "none");
}

init();
