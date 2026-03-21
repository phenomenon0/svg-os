/**
 * SVG → PNG export via Canvas2D.
 *
 * Pipeline: SVG string → base64 data URI → Image → offscreen canvas → PNG blob.
 * Runs entirely in-browser, no server needed.
 */

/**
 * Convert an SVG string to a PNG blob at the given dimensions.
 * Uses devicePixelRatio for crisp output on HiDPI displays.
 */
export async function svgToPng(
  svgString: string,
  width: number,
  height: number,
  scale: number = window.devicePixelRatio || 1,
  bgColor?: string,
): Promise<Blob> {
  // Encode SVG as a data URI
  const encoded = btoa(unescape(encodeURIComponent(svgString)));
  const dataUri = `data:image/svg+xml;base64,${encoded}`;

  // Load into an Image element
  const img = await loadImage(dataUri);

  // Draw to an offscreen canvas at scaled resolution
  const canvas = document.createElement("canvas");
  canvas.width = width * scale;
  canvas.height = height * scale;

  const ctx = canvas.getContext("2d")!;
  ctx.scale(scale, scale);

  // Optional background fill (for non-transparent exports)
  if (bgColor) {
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, width, height);
  }

  ctx.drawImage(img, 0, 0, width, height);

  // Extract as PNG blob
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Canvas toBlob returned null"));
      },
      "image/png",
    );
  });
}

/** Load an image from a URL, returning a promise that resolves when loaded. */
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image: ${src.slice(0, 60)}...`));
    img.src = src;
  });
}

/** Trigger a browser download of a blob with the given filename. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
