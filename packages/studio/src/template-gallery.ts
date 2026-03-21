/**
 * Template gallery — manages the built-in template library.
 *
 * Each template is a self-contained SVG with data-bind conventions.
 * The gallery renders thumbnail previews and lets users pick a template.
 */

export interface TemplateMeta {
  id: string;
  name: string;
  description: string;
  svgContent: string;
  cardWidth: number;
  cardHeight: number;
  slots: { name: string; type: "text" | "color" | "number" }[];
  sampleData: Record<string, unknown>[];
  /** If true, this template requires shader preprocessing before rendering. */
  shaderTemplate?: boolean;
}

// Template SVGs are loaded at build time via ?raw imports in main.ts
// and registered here at runtime.
const templates: TemplateMeta[] = [];

export function registerTemplate(meta: TemplateMeta): void {
  templates.push(meta);
}

export function getTemplates(): TemplateMeta[] {
  return templates;
}

export function getTemplateById(id: string): TemplateMeta | undefined {
  return templates.find((t) => t.id === id);
}

/**
 * Render the template gallery into a container element.
 * Returns a cleanup function.
 */
export function renderGallery(
  container: HTMLElement,
  onSelect: (template: TemplateMeta) => void,
): () => void {
  container.innerHTML = "";

  const heading = document.createElement("h2");
  heading.textContent = "Templates";
  heading.className = "gallery-heading";
  container.appendChild(heading);

  const grid = document.createElement("div");
  grid.className = "gallery-grid";
  container.appendChild(grid);

  const cards: HTMLElement[] = [];

  for (const tmpl of templates) {
    const card = document.createElement("div");
    card.className = "gallery-card";
    card.dataset.templateId = tmpl.id;

    // Thumbnail: render the SVG at small scale
    const thumb = document.createElement("div");
    thumb.className = "gallery-thumb";
    // Create a scaled-down SVG preview
    const aspect = tmpl.cardWidth / tmpl.cardHeight;
    const thumbWidth = 200;
    const thumbHeight = thumbWidth / aspect;
    thumb.innerHTML = tmpl.svgContent;
    const svg = thumb.querySelector("svg");
    if (svg) {
      svg.setAttribute("width", String(thumbWidth));
      svg.setAttribute("height", String(thumbHeight));
    }
    card.appendChild(thumb);

    const info = document.createElement("div");
    info.className = "gallery-info";
    info.innerHTML = `
      <div class="gallery-name">${tmpl.name}</div>
      <div class="gallery-desc">${tmpl.description}</div>
      <div class="gallery-dims">${tmpl.cardWidth} × ${tmpl.cardHeight}px</div>
    `;
    card.appendChild(info);

    card.addEventListener("click", () => {
      // Deselect all
      for (const c of cards) c.classList.remove("selected");
      card.classList.add("selected");
      onSelect(tmpl);
    });

    grid.appendChild(card);
    cards.push(card);
  }

  return () => {
    container.innerHTML = "";
  };
}
