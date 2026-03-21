/**
 * Batch renderer — processes N data rows into N PNG blobs.
 *
 * For each row: clone SVG → resolve bindings in DOM → serialize → svgToPng().
 * Uses requestAnimationFrame yielding to keep the UI responsive during
 * large batch exports (hundreds/thousands of cards).
 *
 * Supports per-row dimensions via `_width` / `_height` fields and an optional
 * `preprocess` hook for injecting computed values (e.g. shader-rendered backgrounds).
 */

import { svgToPng } from "./png-export.js";
import { resolveTemplateSvg } from "./template-bind.js";

export interface BatchProgress {
  current: number;
  total: number;
  /** Percentage 0–100. */
  percent: number;
}

export interface BatchResult {
  blobs: Blob[];
  elapsed: number;
}

/**
 * Render a batch of cards from template SVG + data rows.
 *
 * @param templateSvg  - The template SVG string with data-bind attributes
 * @param rows         - Array of data objects, one per card
 * @param cardWidth    - Default output PNG width in px (overridden by row._width)
 * @param cardHeight   - Default output PNG height in px (overridden by row._height)
 * @param onProgress   - Called after each card renders
 * @param columnMap    - Optional mapping from template slot names to data column names
 * @param scale        - Output scale factor (default 2)
 * @param bgColor      - Optional background color
 * @param preprocess   - Optional async hook called before binding each row
 */
export async function renderBatch(
  templateSvg: string,
  rows: Record<string, unknown>[],
  cardWidth: number,
  cardHeight: number,
  onProgress?: (progress: BatchProgress) => void,
  columnMap?: Record<string, string>,
  scale: number = 2,
  bgColor?: string,
  preprocess?: (row: Record<string, unknown>, index: number) => Promise<Record<string, unknown>>,
): Promise<BatchResult> {
  const start = performance.now();
  const blobs: Blob[] = [];

  for (let i = 0; i < rows.length; i++) {
    // Run preprocess hook (e.g. shader rendering)
    let row = rows[i];
    if (preprocess) {
      row = await preprocess(row, i);
    }

    // Per-row dimensions override
    const w = typeof row._width === "number" ? row._width : cardWidth;
    const h = typeof row._height === "number" ? row._height : cardHeight;

    // Resize SVG if dimensions differ from template default
    let svg = templateSvg;
    if (w !== cardWidth || h !== cardHeight) {
      svg = resizeSvg(svg, w, h);
    }

    // Resolve bindings for this row
    const resolvedSvg = resolveTemplateSvg(svg, row, columnMap);

    // Render to PNG at specified scale and background
    const blob = await svgToPng(resolvedSvg, w, h, scale, bgColor);
    blobs.push(blob);

    // Report progress
    onProgress?.({
      current: i + 1,
      total: rows.length,
      percent: Math.round(((i + 1) / rows.length) * 100),
    });

    // Yield to the browser every 4 cards to keep UI responsive
    if (i % 4 === 3) {
      await yieldToMain();
    }
  }

  return {
    blobs,
    elapsed: performance.now() - start,
  };
}

/**
 * Resize an SVG string's root element width, height, and viewBox.
 * Preserves the original viewBox aspect for content, but updates the
 * root dimensions so the output renders at the new size.
 */
export function resizeSvg(svgString: string, newWidth: number, newHeight: number): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgString, "image/svg+xml");
  const svg = doc.documentElement;

  svg.setAttribute("width", String(newWidth));
  svg.setAttribute("height", String(newHeight));
  svg.setAttribute("viewBox", `0 0 ${newWidth} ${newHeight}`);

  // Also update data-card-width/height if present
  if (svg.hasAttribute("data-card-width")) {
    svg.setAttribute("data-card-width", String(newWidth));
  }
  if (svg.hasAttribute("data-card-height")) {
    svg.setAttribute("data-card-height", String(newHeight));
  }

  return new XMLSerializer().serializeToString(svg);
}

/** Yield control back to the browser's main thread. */
function yieldToMain(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}
