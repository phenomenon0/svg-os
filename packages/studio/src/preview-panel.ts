/**
 * Preview panel — scrollable grid of generated cards + full-size modal.
 *
 * Grid preview: DOM-side binding (fast, stateless cloning for N cards).
 * Modal preview: WASM engine when available (proves the runtime), DOM fallback.
 */

import { resolveTemplateSvg } from "./template-bind.js";
import type { ColumnMapping } from "./binding-panel.js";
import {
  createAnimationController,
  ANIMATION_PRESETS,
  type AnimationController,
  type AnimationConfig,
} from "./animation-engine.js";

export interface PreviewState {
  templateSvg: string;
  rows: Record<string, unknown>[];
  cardWidth: number;
  cardHeight: number;
  columnMap: ColumnMapping;
}

/** Optional WASM render function, set by main.ts when engine is available. */
type WasmRenderFn = (
  templateSvg: string,
  rowData: Record<string, unknown>,
  columnMap: Record<string, string>,
  container: Element,
) => boolean;

let wasmRenderFn: WasmRenderFn | null = null;

/** Register a WASM renderer for modal previews. */
export function setWasmRenderer(fn: WasmRenderFn): void {
  wasmRenderFn = fn;
}

/** Optional animation config, set by main.ts. */
let animConfig: AnimationConfig = { presetName: "pulse-glow", shaderAnimate: false };
let animEnabled = false;
let animController: AnimationController | null = null;
type ShaderAnimRenderFn = (seed: number) => Promise<string>;
let shaderAnimRenderFn: ShaderAnimRenderFn | null = null;

/** Set animation configuration from main. */
export function setAnimationConfig(config: { enabled: boolean; shaderRenderFn?: ShaderAnimRenderFn }): void {
  animEnabled = config.enabled;
  if (config.shaderRenderFn) shaderAnimRenderFn = config.shaderRenderFn;
}

let modalEl: HTMLElement | null = null;
let currentModalIndex = 0;
let currentState: PreviewState | null = null;

/**
 * Render the preview grid into a container.
 * Uses DOM-side binding (clone + resolve per card).
 */
export function renderPreviewGrid(
  container: HTMLElement,
  state: PreviewState,
): void {
  currentState = state;
  container.innerHTML = "";

  if (state.rows.length === 0) {
    const empty = document.createElement("div");
    empty.className = "preview-empty";
    empty.textContent = "Upload data to see previews";
    container.appendChild(empty);
    return;
  }

  const grid = document.createElement("div");
  grid.className = "preview-grid";

  const thumbWidth = 180;
  const scale = thumbWidth / state.cardWidth;
  const thumbHeight = state.cardHeight * scale;

  for (let i = 0; i < state.rows.length; i++) {
    const card = document.createElement("div");
    card.className = "preview-card";
    card.style.width = `${thumbWidth}px`;
    card.style.height = `${thumbHeight}px`;
    card.title = `Card ${i + 1} of ${state.rows.length}`;

    const resolvedSvg = resolveTemplateSvg(
      state.templateSvg,
      state.rows[i],
      state.columnMap,
      `p${i}`,
    );

    card.innerHTML = resolvedSvg;
    const svg = card.querySelector("svg");
    if (svg) {
      svg.setAttribute("width", String(thumbWidth));
      svg.setAttribute("height", String(thumbHeight));
      svg.style.width = "100%";
      svg.style.height = "100%";
    }

    const label = document.createElement("div");
    label.className = "preview-label";
    label.textContent = `#${i + 1}`;
    card.appendChild(label);

    // 3D tilt on hover
    card.addEventListener("mousemove", (e: MouseEvent) => {
      const rect = card.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width - 0.5);
      const y = ((e.clientY - rect.top) / rect.height - 0.5);
      card.style.transform = `perspective(800px) rotateY(${x * 10}deg) rotateX(${-y * 10}deg)`;
    });
    card.addEventListener("mouseleave", () => {
      card.style.transform = "";
    });

    // Card entrance animation (staggered)
    card.style.animation = "card-entrance 0.4s ease-out forwards";
    card.style.animationDelay = `${i * 0.05}s`;
    card.style.opacity = "0";

    card.addEventListener("click", () => openModal(i));
    grid.appendChild(card);
  }

  container.appendChild(grid);

  const count = document.createElement("div");
  count.className = "preview-count";
  count.textContent = `${state.rows.length} card${state.rows.length === 1 ? "" : "s"}`;
  container.appendChild(count);
}

/** Open the full-size preview modal for a specific card index. */
function openModal(index: number): void {
  if (!currentState) return;
  currentModalIndex = index;

  if (!modalEl) {
    modalEl = document.createElement("div");
    modalEl.className = "preview-modal";
    modalEl.innerHTML = `
      <div class="modal-backdrop"></div>
      <div class="modal-content">
        <div class="modal-header">
          <span class="modal-title"></span>
          <span class="modal-engine"></span>
          <div class="modal-anim-controls">
            <button class="modal-anim-toggle" title="Play/Pause animation">&#9654;</button>
            <select class="binding-select modal-anim-preset" title="Animation preset"></select>
            <label class="modal-shader-toggle-label" style="display:none">
              <input type="checkbox" class="modal-shader-toggle"> Shader
            </label>
          </div>
          <button class="modal-close">&times;</button>
        </div>
        <div class="modal-body"></div>
        <div class="modal-nav">
          <button class="modal-prev">&larr; Previous</button>
          <button class="modal-next">Next &rarr;</button>
        </div>
      </div>
    `;
    document.body.appendChild(modalEl);

    modalEl.querySelector(".modal-backdrop")!.addEventListener("click", closeModal);
    modalEl.querySelector(".modal-close")!.addEventListener("click", closeModal);
    modalEl.querySelector(".modal-prev")!.addEventListener("click", () => navigateModal(-1));
    modalEl.querySelector(".modal-next")!.addEventListener("click", () => navigateModal(1));

    // Animation controls setup
    const presetSelect = modalEl.querySelector(".modal-anim-preset") as HTMLSelectElement;
    for (const preset of ANIMATION_PRESETS) {
      const opt = document.createElement("option");
      opt.value = preset.name;
      opt.textContent = preset.label;
      presetSelect.appendChild(opt);
    }
    presetSelect.value = animConfig.presetName;
    presetSelect.addEventListener("change", () => {
      animConfig.presetName = presetSelect.value;
      rebuildAnimController();
    });

    const animToggle = modalEl.querySelector(".modal-anim-toggle") as HTMLButtonElement;
    animToggle.addEventListener("click", () => {
      if (!animController) {
        rebuildAnimController();
        if (animController) {
          (animController as AnimationController).play();
        }
        animToggle.textContent = "\u23F8";
        animToggle.classList.add("playing");
      } else if (animController.isPlaying) {
        animController.pause();
        animToggle.textContent = "\u25B6";
        animToggle.classList.remove("playing");
      } else {
        animController.play();
        animToggle.textContent = "\u23F8";
        animToggle.classList.add("playing");
      }
    });

    const shaderToggle = modalEl.querySelector(".modal-shader-toggle") as HTMLInputElement;
    shaderToggle.addEventListener("change", () => {
      animConfig.shaderAnimate = shaderToggle.checked;
      rebuildAnimController();
      if (animController?.isPlaying) {
        animController.play();
      }
    });

    // 3D tilt on modal body
    const modalBody = modalEl.querySelector(".modal-body") as HTMLElement;
    modalBody.addEventListener("mousemove", (e: MouseEvent) => {
      const rect = modalBody.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width - 0.5);
      const y = ((e.clientY - rect.top) / rect.height - 0.5);
      modalBody.style.transform = `perspective(800px) rotateY(${x * 15}deg) rotateX(${-y * 15}deg)`;
    });
    modalBody.addEventListener("mouseleave", () => {
      modalBody.style.transform = "";
    });

    document.addEventListener("keydown", handleModalKey);
  }

  modalEl.style.display = "flex";
  updateModalContent();
}

function closeModal(): void {
  destroyAnimController();
  if (modalEl) {
    modalEl.style.display = "none";
    // Reset play button
    const btn = modalEl.querySelector(".modal-anim-toggle") as HTMLButtonElement;
    if (btn) { btn.textContent = "\u25B6"; btn.classList.remove("playing"); }
  }
}

function destroyAnimController(): void {
  if (animController) {
    animController.destroy();
    animController = null;
  }
}

function rebuildAnimController(): void {
  destroyAnimController();
  if (!modalEl) return;
  const body = modalEl.querySelector(".modal-body") as HTMLElement;
  animController = createAnimationController(
    body,
    animConfig,
    animConfig.shaderAnimate && shaderAnimRenderFn ? shaderAnimRenderFn : undefined,
  );
}

function navigateModal(delta: number): void {
  if (!currentState) return;
  destroyAnimController();
  currentModalIndex = Math.max(
    0,
    Math.min(currentState.rows.length - 1, currentModalIndex + delta),
  );
  updateModalContent();
  // Reset play button
  if (modalEl) {
    const btn = modalEl.querySelector(".modal-anim-toggle") as HTMLButtonElement;
    if (btn) { btn.textContent = "\u25B6"; btn.classList.remove("playing"); }
  }
}

function handleModalKey(e: KeyboardEvent): void {
  if (!modalEl || modalEl.style.display === "none") return;
  if (e.key === "Escape") closeModal();
  if (e.key === "ArrowLeft") navigateModal(-1);
  if (e.key === "ArrowRight") navigateModal(1);
}

function updateModalContent(): void {
  if (!modalEl || !currentState) return;

  const title = modalEl.querySelector(".modal-title")!;
  title.textContent = `Card ${currentModalIndex + 1} of ${currentState.rows.length}`;

  const engineLabel = modalEl.querySelector(".modal-engine")!;
  const body = modalEl.querySelector(".modal-body")!;

  // Try WASM render first, fall back to DOM.
  // Skip WASM for shader templates — the Rust engine doesn't handle
  // data-bind-attr-href or injected shader_bg data URIs.
  const row = currentState.rows[currentModalIndex];
  const isShaderRow = row.shader_bg !== undefined;
  let usedWasm = false;
  if (wasmRenderFn && !isShaderRow) {
    try {
      usedWasm = wasmRenderFn(
        currentState.templateSvg,
        row,
        currentState.columnMap,
        body,
      );
    } catch {
      usedWasm = false;
    }
  }

  if (!usedWasm) {
    // DOM fallback
    const resolvedSvg = resolveTemplateSvg(
      currentState.templateSvg,
      currentState.rows[currentModalIndex],
      currentState.columnMap,
      `modal`,
    );

    body.innerHTML = resolvedSvg;
  }

  // Style the rendered SVG
  const svg = body.querySelector("svg");
  if (svg) {
    svg.style.maxWidth = "100%";
    svg.style.maxHeight = "70vh";
    svg.style.width = "auto";
    svg.style.height = "auto";
  }

  // Show which engine rendered this card
  engineLabel.textContent = usedWasm ? "WASM" : "DOM";
  (engineLabel as HTMLElement).style.cssText = usedWasm
    ? "font-size:9px;padding:2px 6px;border-radius:4px;background:#14532d;color:#4ade80;font-weight:600;letter-spacing:0.06em"
    : "font-size:9px;padding:2px 6px;border-radius:4px;background:#1e293b;color:#64748b;font-weight:600;letter-spacing:0.06em";

  // Update nav button states
  const prev = modalEl.querySelector(".modal-prev") as HTMLButtonElement;
  const next = modalEl.querySelector(".modal-next") as HTMLButtonElement;
  prev.disabled = currentModalIndex === 0;
  next.disabled = currentModalIndex === currentState.rows.length - 1;

  // Show/hide shader animate toggle
  const shaderLabel = modalEl.querySelector(".modal-shader-toggle-label") as HTMLElement;
  if (shaderLabel) {
    shaderLabel.style.display = isShaderRow ? "" : "none";
  }
}
