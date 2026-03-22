/**
 * Node Palette — sidebar panel listing available node types by category.
 *
 * Click a type to enter "place node" mode, then click the canvas to instantiate.
 */

import { listNodeTypes, registerNodeType, instantiateNodeType } from "@svg-os/bridge";

export interface PaletteCallbacks {
  onPlaceNode: (typeId: string, x: number, y: number) => void;
  onModeChange: (mode: "placing" | "idle") => void;
}

interface NodeTypeInfo {
  id: string;
  name: string;
  category: string;
  slots: Array<{ field: string; bind_type: string; target_attr: string }>;
  default_width: number;
  default_height: number;
}

let selectedTypeId: string | null = null;
let callbacks: PaletteCallbacks | null = null;

/**
 * Initialize the palette panel. Call after WASM is loaded.
 */
export function initPalette(container: HTMLElement, cbs: PaletteCallbacks): void {
  callbacks = cbs;

  // Register built-in types from templates (loaded via fetch at runtime)
  registerBuiltinTypes();

  // Render palette UI
  renderPalette(container);
}

/**
 * Get the currently selected type for placement. null = not placing.
 */
export function getPlacingType(): string | null {
  return selectedTypeId;
}

/**
 * Called when the user clicks the canvas while in placing mode.
 */
export function placeNode(x: number, y: number): string | null {
  if (!selectedTypeId) return null;
  const nodeId = instantiateNodeType(selectedTypeId, x, y);
  // Stay in placing mode (click again to place another)
  return nodeId;
}

/**
 * Cancel placing mode.
 */
export function cancelPlacing(): void {
  selectedTypeId = null;
  callbacks?.onModeChange("idle");
  // Remove active state from palette items
  document.querySelectorAll(".palette-item.active").forEach(el => el.classList.remove("active"));
}

function renderPalette(container: HTMLElement): void {
  const types = listNodeTypes();

  // Group by category
  const categories = new Map<string, NodeTypeInfo[]>();
  for (const t of types) {
    if (!categories.has(t.category)) {
      categories.set(t.category, []);
    }
    categories.get(t.category)!.push(t);
  }

  container.innerHTML = "";

  const header = document.createElement("div");
  header.style.cssText = "padding: 8px 12px; font-size: 11px; font-weight: 600; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em; border-bottom: 1px solid #334155;";
  header.textContent = "Node Types";
  container.appendChild(header);

  for (const [category, items] of categories) {
    const catDiv = document.createElement("div");
    catDiv.style.cssText = "border-bottom: 1px solid #1e293b;";

    const catHeader = document.createElement("div");
    catHeader.style.cssText = "padding: 6px 12px; font-size: 10px; font-weight: 600; color: #64748b; text-transform: uppercase; letter-spacing: 0.08em; cursor: pointer;";
    catHeader.textContent = category;
    catDiv.appendChild(catHeader);

    const itemList = document.createElement("div");
    itemList.style.cssText = "padding: 0 4px 4px;";

    for (const item of items) {
      const el = document.createElement("div");
      el.className = "palette-item";
      el.dataset.typeId = item.id;
      el.style.cssText = `
        padding: 6px 8px;
        margin: 1px 0;
        border-radius: 4px;
        cursor: pointer;
        font-size: 12px;
        color: #cbd5e1;
        display: flex;
        align-items: center;
        gap: 6px;
        transition: background 0.1s;
      `;

      const icon = document.createElement("span");
      icon.style.cssText = "width: 16px; height: 16px; border-radius: 3px; background: #334155; display: flex; align-items: center; justify-content: center; font-size: 9px; flex-shrink: 0;";
      icon.textContent = item.name.charAt(0).toUpperCase();
      el.appendChild(icon);

      const label = document.createElement("span");
      label.textContent = item.name;
      label.style.cssText = "overflow: hidden; text-overflow: ellipsis; white-space: nowrap;";
      el.appendChild(label);

      const slotCount = document.createElement("span");
      slotCount.style.cssText = "margin-left: auto; font-size: 10px; color: #475569; flex-shrink: 0;";
      slotCount.textContent = `${item.slots.length}`;
      el.appendChild(slotCount);

      el.addEventListener("mouseenter", () => {
        if (el.dataset.typeId !== selectedTypeId) {
          el.style.background = "#1e293b";
        }
      });
      el.addEventListener("mouseleave", () => {
        if (el.dataset.typeId !== selectedTypeId) {
          el.style.background = "transparent";
        }
      });
      el.addEventListener("click", () => {
        // Toggle selection
        if (selectedTypeId === item.id) {
          cancelPlacing();
          return;
        }
        // Deselect previous
        document.querySelectorAll(".palette-item.active").forEach(prev => {
          (prev as HTMLElement).style.background = "transparent";
          prev.classList.remove("active");
        });
        // Select this
        selectedTypeId = item.id;
        el.classList.add("active");
        el.style.background = "#1e3a5f";
        callbacks?.onModeChange("placing");
      });

      itemList.appendChild(el);
    }

    catDiv.appendChild(itemList);
    container.appendChild(catDiv);
  }

  // If no types registered yet, show loading message
  if (types.length === 0) {
    const empty = document.createElement("div");
    empty.style.cssText = "padding: 12px; color: #475569; font-size: 12px; text-align: center;";
    empty.textContent = "No node types registered";
    container.appendChild(empty);
  }
}

/**
 * Register built-in node types from the fixtures/templates directory.
 * These are loaded via fetch since they're static SVG files.
 */
async function registerBuiltinTypes(): Promise<void> {
  const builtins = [
    { id: "scouting-report", name: "Scouting Report", category: "cards", file: "scouting-report.svg" },
    { id: "match-card", name: "Match Card", category: "cards", file: "match-card.svg" },
    { id: "team-card", name: "Team Card", category: "cards", file: "team-card.svg" },
    { id: "profile-hud", name: "Profile HUD", category: "cards", file: "profile-hud.svg" },
    { id: "game-achievement", name: "Achievement", category: "cards", file: "game-achievement.svg" },
    { id: "portfolio-card", name: "Portfolio Card", category: "cards", file: "portfolio-card.svg" },
    { id: "pricing-card", name: "Pricing Card", category: "cards", file: "pricing-card.svg" },
    { id: "team-member-card", name: "Team Member", category: "cards", file: "team-member-card.svg" },
    { id: "brand-showcase", name: "Brand Showcase", category: "display", file: "brand-showcase.svg" },
    { id: "event-flyer", name: "Event Flyer", category: "display", file: "event-flyer.svg" },
    { id: "hero-card", name: "Hero Card", category: "display", file: "hero-card.svg" },
    { id: "shader-card", name: "Shader Card", category: "display", file: "shader-card.svg" },
    { id: "shader-poster", name: "Shader Poster", category: "display", file: "shader-poster.svg" },
  ];

  // Also register basic diagram node types (no SVG file, generated)
  const diagramTypes = [
    { id: "service-node", name: "Service", category: "diagrams" },
    { id: "database-node", name: "Database", category: "diagrams" },
    { id: "text-block", name: "Text Block", category: "display" },
  ];

  for (const dt of diagramTypes) {
    const svg = makeDiagramNodeSvg(dt.id, dt.name);
    try {
      registerNodeType({ id: dt.id, name: dt.name, category: dt.category, template_svg: svg });
    } catch { /* ignore if already registered */ }
  }

  // Load template SVGs from fixtures (relative path depends on dev server)
  for (const bt of builtins) {
    try {
      const resp = await fetch(`../../fixtures/templates/${bt.file}`);
      if (resp.ok) {
        const svg = await resp.text();
        registerNodeType({ id: bt.id, name: bt.name, category: bt.category, template_svg: svg });
      }
    } catch { /* ignore load failures */ }
  }

  // Re-render palette after loading
  const paletteContainer = document.getElementById("node-palette");
  if (paletteContainer) {
    renderPalette(paletteContainer);
  }
}

function makeDiagramNodeSvg(id: string, label: string): string {
  const colors: Record<string, [string, string]> = {
    "service-node": ["#1e293b", "#475569"],
    "database-node": ["#164e63", "#06b6d4"],
    "text-block": ["#1e293b", "#64748b"],
  };
  const [fill, stroke] = colors[id] ?? ["#1e293b", "#475569"];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="80">
  <rect width="160" height="80" rx="8" fill="${fill}" stroke="${stroke}" stroke-width="2"/>
  <text x="80" y="45" text-anchor="middle" font-family="Inter, sans-serif" font-size="14" fill="#e2e8f0">${label}</text>
</svg>`;
}
