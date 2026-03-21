/**
 * Palette panel — UI for generative color palette selection.
 *
 * Follows the binding-panel pattern: receives a container element,
 * renders controls, calls onChange on user interaction, returns cleanup.
 */

import {
  generatePalette,
  PALETTE_MODES,
  type PaletteMode,
} from "./palette-generator.js";

export interface PaletteConfig {
  baseColor: string;
  mode: PaletteMode;
  enabled: boolean;
}

/**
 * Render the palette panel into a container.
 * Returns current config and a cleanup function.
 */
export function renderPalettePanel(
  container: HTMLElement,
  initialConfig: PaletteConfig,
  onChange: (config: PaletteConfig) => void,
): { getConfig: () => PaletteConfig; cleanup: () => void } {
  const config: PaletteConfig = { ...initialConfig };

  // ── Heading ───────────────────────────────────────────
  const heading = document.createElement("h2");
  heading.textContent = "Color Palette";
  heading.className = "panel-heading";
  container.appendChild(heading);

  // ── Enable toggle ─────────────────────────────────────
  const toggleRow = document.createElement("div");
  toggleRow.className = "binding-row";

  const toggleLabel = document.createElement("label");
  toggleLabel.className = "palette-toggle-label";
  toggleLabel.textContent = "Enable palette";
  toggleLabel.style.cssText = "font-size:12px;color:#e2e8f0;flex:1;cursor:pointer";

  const toggle = document.createElement("input");
  toggle.type = "checkbox";
  toggle.checked = config.enabled;
  toggle.className = "palette-toggle";
  toggle.addEventListener("change", () => {
    config.enabled = toggle.checked;
    updateSwatches();
    onChange(config);
  });

  toggleLabel.prepend(toggle);
  toggleRow.appendChild(toggleLabel);
  container.appendChild(toggleRow);

  // ── Color picker row ──────────────────────────────────
  const colorRow = document.createElement("div");
  colorRow.className = "binding-row";
  colorRow.style.gap = "8px";

  const colorLabel = document.createElement("span");
  colorLabel.className = "binding-field";
  colorLabel.textContent = "Base";
  colorRow.appendChild(colorLabel);

  const colorInput = document.createElement("input");
  colorInput.type = "color";
  colorInput.value = config.baseColor;
  colorInput.className = "palette-color-input";
  colorInput.addEventListener("input", () => {
    config.baseColor = colorInput.value;
    hexLabel.textContent = colorInput.value.toUpperCase();
    updateSwatches();
    onChange(config);
  });
  colorRow.appendChild(colorInput);

  const hexLabel = document.createElement("span");
  hexLabel.className = "binding-field";
  hexLabel.textContent = config.baseColor.toUpperCase();
  hexLabel.style.cssText = "font-size:11px;color:#94a3b8;font-family:'JetBrains Mono','Fira Code',monospace";
  colorRow.appendChild(hexLabel);

  container.appendChild(colorRow);

  // ── Mode selector ─────────────────────────────────────
  const modeRow = document.createElement("div");
  modeRow.className = "binding-row";

  const modeLabel = document.createElement("span");
  modeLabel.className = "binding-field";
  modeLabel.textContent = "Mode";
  modeRow.appendChild(modeLabel);

  const modeSelect = document.createElement("select");
  modeSelect.className = "binding-select";
  modeSelect.style.width = "140px";
  for (const mode of PALETTE_MODES) {
    const opt = document.createElement("option");
    opt.value = mode;
    opt.textContent = mode.replace("-", " ");
    modeSelect.appendChild(opt);
  }
  modeSelect.value = config.mode;
  modeSelect.addEventListener("change", () => {
    config.mode = modeSelect.value as PaletteMode;
    updateSwatches();
    onChange(config);
  });
  modeRow.appendChild(modeSelect);
  container.appendChild(modeRow);

  // ── Swatch preview ────────────────────────────────────
  const swatchContainer = document.createElement("div");
  swatchContainer.className = "palette-swatches";
  container.appendChild(swatchContainer);

  function updateSwatches(): void {
    const colors = generatePalette(config.baseColor, config.mode, 8);
    swatchContainer.innerHTML = "";
    for (const color of colors) {
      const swatch = document.createElement("div");
      swatch.className = "palette-swatch";
      swatch.style.background = color;
      swatch.title = color.toUpperCase();
      if (!config.enabled) swatch.style.opacity = "0.3";
      swatchContainer.appendChild(swatch);
    }
  }

  updateSwatches();

  return {
    getConfig: () => ({ ...config }),
    cleanup: () => {
      container.innerHTML = "";
    },
  };
}
