/**
 * WASM bridge: loads SVG OS engine and registers built-in templates.
 */

import { loadWasm, registerNodeType, listNodeTypes } from "@svg-os/bridge";

let wasmReady = false;

export async function initWasm(): Promise<void> {
  if (wasmReady) return;
  await loadWasm();
  await registerBuiltinTemplates();
  wasmReady = true;
}

export function isWasmReady(): boolean {
  return wasmReady;
}

const BUILTIN_TEMPLATES = [
  { id: "hero-card", name: "Hero Card", category: "cards", file: "hero-card.svg" },
  { id: "profile-hud", name: "Profile HUD", category: "cards", file: "profile-hud.svg" },
  { id: "pricing-card", name: "Pricing Card", category: "cards", file: "pricing-card.svg" },
  { id: "team-member-card", name: "Team Member", category: "cards", file: "team-member-card.svg" },
  { id: "shader-card", name: "Shader Card", category: "display", file: "shader-card.svg" },
  { id: "shader-poster", name: "Shader Poster", category: "display", file: "shader-poster.svg" },
];

// Simple diagram nodes (generated SVGs, not loaded from files)
const DIAGRAM_NODES = [
  { id: "service-node", name: "Service", category: "diagrams", fill: "#1e293b", stroke: "#475569" },
  { id: "database-node", name: "Database", category: "diagrams", fill: "#164e63", stroke: "#06b6d4" },
  { id: "cache-node", name: "Cache", category: "diagrams", fill: "#713f12", stroke: "#f59e0b" },
  { id: "queue-node", name: "Queue", category: "diagrams", fill: "#3b0764", stroke: "#a855f7" },
  { id: "client-node", name: "Client", category: "diagrams", fill: "#052e16", stroke: "#22c55e" },
];

async function registerBuiltinTemplates(): Promise<void> {
  // Register diagram nodes first (no fetch needed)
  for (const dn of DIAGRAM_NODES) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="80">
  <rect width="160" height="80" rx="8" fill="${dn.fill}" stroke="${dn.stroke}" stroke-width="2"/>
  <text x="80" y="45" text-anchor="middle" font-family="Inter, sans-serif" font-size="14" fill="#e2e8f0">${dn.name}</text>
</svg>`;
    try {
      registerNodeType({ id: dn.id, name: dn.name, category: dn.category, template_svg: svg });
    } catch { /* ignore */ }
  }

  // Load template SVGs from fixtures
  const results = await Promise.allSettled(
    BUILTIN_TEMPLATES.map(async (bt) => {
      const resp = await fetch(`/templates/${bt.file}`);
      if (!resp.ok) return;
      const svg = await resp.text();
      registerNodeType({ id: bt.id, name: bt.name, category: bt.category, template_svg: svg });
    })
  );

  const loaded = results.filter((r) => r.status === "fulfilled").length;
  console.log(`[svg-os] Registered ${DIAGRAM_NODES.length} diagram nodes + ${loaded} templates`);
}
