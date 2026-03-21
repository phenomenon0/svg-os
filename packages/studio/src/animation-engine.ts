/**
 * Animation engine — CSS keyframe presets for live SVG preview.
 *
 * Provides 6 animation presets that can be applied to data-bound SVG elements,
 * plus a shader animation loop for GPU-rendered backgrounds. The controller
 * manages lifecycle (play/pause/stop/destroy) and cleans up on navigation.
 */

// ── Preset definitions ──────────────────────────────────────────────────────

export interface AnimPreset {
  name: string;
  label: string;
  keyframes: string;
  duration: string;
  iteration: string;
  timing: string;
}

export const ANIMATION_PRESETS: AnimPreset[] = [
  {
    name: "pulse-glow",
    label: "Pulse Glow",
    keyframes: `@keyframes pulse-glow {
  0%, 100% { filter: drop-shadow(0 0 2px currentColor); }
  50% { filter: drop-shadow(0 0 12px currentColor); }
}`,
    duration: "2s",
    iteration: "infinite",
    timing: "ease-in-out",
  },
  {
    name: "fill-bar",
    label: "Fill Bar",
    keyframes: `@keyframes fill-bar {
  from { transform: scaleX(0); transform-origin: left; }
  to { transform: scaleX(1); transform-origin: left; }
}`,
    duration: "1.2s",
    iteration: "forwards",
    timing: "ease-out",
  },
  {
    name: "fade-in",
    label: "Fade In",
    keyframes: `@keyframes fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}`,
    duration: "0.8s",
    iteration: "forwards",
    timing: "ease-out",
  },
  {
    name: "slide-up",
    label: "Slide Up",
    keyframes: `@keyframes slide-up {
  from { opacity: 0; transform: translateY(20px); }
  to { opacity: 1; transform: translateY(0); }
}`,
    duration: "0.6s",
    iteration: "forwards",
    timing: "ease-out",
  },
  {
    name: "shimmer",
    label: "Shimmer",
    keyframes: `@keyframes shimmer {
  0%, 100% { filter: brightness(1); }
  50% { filter: brightness(1.3); }
}`,
    duration: "2.5s",
    iteration: "infinite",
    timing: "ease-in-out",
  },
  {
    name: "breathe",
    label: "Breathe",
    keyframes: `@keyframes breathe {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.02); }
}`,
    duration: "3s",
    iteration: "infinite",
    timing: "ease-in-out",
  },
];

// ── Animation Controller ────────────────────────────────────────────────────

export interface AnimationController {
  play(): void;
  pause(): void;
  stop(): void;
  isPlaying: boolean;
  destroy(): void;
}

export interface AnimationConfig {
  presetName: string;
  shaderAnimate: boolean;
}

type ShaderRenderFn = (seed: number) => Promise<string>;

/**
 * Create an animation controller for a modal SVG preview.
 *
 * 1. Finds data-bind elements in the SVG
 * 2. Injects @keyframes style into the SVG DOM
 * 3. Applies animations to targeted elements
 * 4. For shader templates: runs a rAF loop incrementing the seed
 */
export function createAnimationController(
  container: HTMLElement,
  config: AnimationConfig,
  shaderRenderFn?: ShaderRenderFn,
): AnimationController {
  const preset = ANIMATION_PRESETS.find((p) => p.name === config.presetName);
  let playing = false;
  let rafId = 0;
  let shaderSeed = 0;
  let renderPending = false;
  let destroyed = false;

  // Inject keyframes style into the container's SVG
  let styleEl: HTMLStyleElement | null = null;

  if (preset) {
    const svg = container.querySelector("svg");
    if (svg) {
      // Use an HTML style element outside the SVG for CSS animations
      styleEl = document.createElement("style");
      styleEl.textContent = `
        ${preset.keyframes}
        .anim-target {
          animation: ${preset.name} ${preset.duration} ${preset.timing} ${preset.iteration};
        }
      `;
      container.appendChild(styleEl);

      // Apply to data-bind elements
      const targets = svg.querySelectorAll("[data-bind], [data-bind-text], [data-bind-attr-fill]");
      targets.forEach((el) => {
        (el as HTMLElement).classList.add("anim-target");
      });
    }
  }

  // Shader animation loop
  function shaderLoop(): void {
    if (!playing || destroyed || !shaderRenderFn) return;
    if (renderPending) {
      rafId = requestAnimationFrame(shaderLoop);
      return;
    }

    shaderSeed += 0.016;
    renderPending = true;

    shaderRenderFn(shaderSeed).then((dataUri) => {
      if (destroyed) return;
      renderPending = false;
      const img = container.querySelector("image[data-bind-attr-href='shader_bg']") as SVGImageElement | null;
      if (img) {
        img.setAttribute("href", dataUri);
      }
      if (playing) {
        rafId = requestAnimationFrame(shaderLoop);
      }
    }).catch(() => {
      renderPending = false;
      if (playing && !destroyed) {
        rafId = requestAnimationFrame(shaderLoop);
      }
    });
  }

  const controller: AnimationController = {
    get isPlaying() {
      return playing;
    },

    play() {
      if (destroyed) return;
      playing = true;
      // Resume CSS animations
      const svg = container.querySelector("svg");
      if (svg) {
        svg.style.animationPlayState = "running";
        svg.querySelectorAll(".anim-target").forEach((el) => {
          (el as HTMLElement).style.animationPlayState = "running";
        });
      }
      // Start shader loop if applicable
      if (config.shaderAnimate && shaderRenderFn) {
        shaderLoop();
      }
    },

    pause() {
      playing = false;
      cancelAnimationFrame(rafId);
      const svg = container.querySelector("svg");
      if (svg) {
        svg.querySelectorAll(".anim-target").forEach((el) => {
          (el as HTMLElement).style.animationPlayState = "paused";
        });
      }
    },

    stop() {
      playing = false;
      cancelAnimationFrame(rafId);
      shaderSeed = 0;
      const svg = container.querySelector("svg");
      if (svg) {
        svg.querySelectorAll(".anim-target").forEach((el) => {
          el.classList.remove("anim-target");
          (el as HTMLElement).style.animationPlayState = "";
        });
      }
    },

    destroy() {
      destroyed = true;
      playing = false;
      cancelAnimationFrame(rafId);
      if (styleEl && styleEl.parentNode) {
        styleEl.parentNode.removeChild(styleEl);
      }
    },
  };

  return controller;
}
