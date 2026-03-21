/**
 * DOM-side template data binding.
 *
 * Walks an SVG DOM for elements with `data-bind` and `data-bind-fill`
 * attributes and resolves them against a data row.
 *
 * This operates on cloned DOM nodes rather than the Rust binding engine,
 * which makes batch export simpler — clone SVG string N times, resolve in DOM,
 * serialize back, no Rust changes needed.
 */

/** Binding slot descriptor extracted from a template. */
export interface TemplateSlot {
  /** The element's data-bind or data-bind-fill attribute value (the field name). */
  field: string;
  /** Whether this binds text content or a fill color. */
  type: "text" | "color";
  /** The element that has this binding (for preview highlighting). */
  element?: Element;
}

/**
 * Scan a container for all data-bind and data-bind-fill attributes.
 * Returns the set of template slots the user can map data columns to.
 */
export function extractSlots(container: Element): TemplateSlot[] {
  const slots: TemplateSlot[] = [];
  const seen = new Set<string>();

  // Text bindings: data-bind="fieldName" → sets textContent
  for (const el of container.querySelectorAll("[data-bind]")) {
    const field = el.getAttribute("data-bind")!;
    const key = `text:${field}`;
    if (!seen.has(key)) {
      seen.add(key);
      slots.push({ field, type: "text", element: el });
    }
  }

  // Color bindings: data-bind-fill="fieldName" → sets fill attribute
  for (const el of container.querySelectorAll("[data-bind-fill]")) {
    const field = el.getAttribute("data-bind-fill")!;
    const key = `color:${field}`;
    if (!seen.has(key)) {
      seen.add(key);
      slots.push({ field, type: "color", element: el });
    }
  }

  // Gradient stop bindings: data-bind-stop="fieldName" → sets stop-color
  for (const el of container.querySelectorAll("[data-bind-stop]")) {
    const field = el.getAttribute("data-bind-stop")!;
    const key = `stop:${field}`;
    if (!seen.has(key)) {
      seen.add(key);
      slots.push({ field, type: "color", element: el });
    }
  }

  // Number bindings: data-bind-attr-*="fieldName" → sets arbitrary attribute
  for (const el of container.querySelectorAll("*")) {
    for (const attr of el.getAttributeNames()) {
      if (attr.startsWith("data-bind-attr-")) {
        const targetAttr = attr.slice("data-bind-attr-".length);
        const field = el.getAttribute(attr)!;
        const key = `attr:${targetAttr}:${field}`;
        if (!seen.has(key)) {
          seen.add(key);
          slots.push({ field, type: "text", element: el });
        }
      }
    }
  }

  return slots;
}

/**
 * Resolve all data bindings in a container element against a data row.
 * Mutates the DOM in place.
 */
export function resolveBindings(
  container: Element,
  data: Record<string, unknown>,
  columnMap?: Record<string, string>,
): void {
  // Text bindings
  for (const el of container.querySelectorAll("[data-bind]")) {
    const field = el.getAttribute("data-bind")!;
    const mappedField = columnMap?.[field] ?? field;
    const value = data[mappedField];
    if (value !== undefined) {
      el.textContent = String(value);
    }
  }

  // Fill color bindings
  for (const el of container.querySelectorAll("[data-bind-fill]")) {
    const field = el.getAttribute("data-bind-fill")!;
    const mappedField = columnMap?.[field] ?? field;
    const value = data[mappedField];
    if (value !== undefined) {
      el.setAttribute("fill", String(value));
    }
  }

  // Gradient stop bindings
  for (const el of container.querySelectorAll("[data-bind-stop]")) {
    const field = el.getAttribute("data-bind-stop")!;
    const mappedField = columnMap?.[field] ?? field;
    const value = data[mappedField];
    if (value !== undefined) {
      el.setAttribute("stop-color", String(value));
    }
  }

  // Arbitrary attribute bindings
  for (const el of container.querySelectorAll("*")) {
    for (const attr of el.getAttributeNames()) {
      if (attr.startsWith("data-bind-attr-")) {
        const targetAttr = attr.slice("data-bind-attr-".length);
        const field = el.getAttribute(attr)!;
        const mappedField = columnMap?.[field] ?? field;
        const value = data[mappedField];
        if (value !== undefined) {
          el.setAttribute(targetAttr, String(value));
          // SVG <image> needs xlink:href for broad browser compat
          if (targetAttr === "href" && el.tagName === "image") {
            el.setAttributeNS("http://www.w3.org/1999/xlink", "xlink:href", String(value));
          }
        }
      }
    }
  }
}

/**
 * Clone an SVG string, resolve bindings against a data row, return the resolved SVG string.
 * This is the core of batch export — each row gets its own resolved SVG.
 *
 * @param idSuffix - Optional suffix to namespace all SVG IDs (prevents inline ID collisions
 *   when multiple resolved SVGs share the same DOM, e.g. in preview grids)
 */
export function resolveTemplateSvg(
  svgString: string,
  data: Record<string, unknown>,
  columnMap?: Record<string, string>,
  idSuffix?: string,
): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgString, "image/svg+xml");
  const svg = doc.documentElement;
  resolveBindings(svg, data, columnMap);

  let result = new XMLSerializer().serializeToString(svg);

  // Namespace IDs to prevent collisions when multiple SVGs are inlined in the same document.
  // Rewrites id="foo" → id="foo-suffix" and all url(#foo) / href="#foo" references.
  if (idSuffix) {
    result = uniquifySvgIds(result, idSuffix);
  }

  return result;
}

/**
 * Append a suffix to every id="..." definition in an SVG string and update
 * all url(#...) and xlink:href="#..." references to match.
 */
function uniquifySvgIds(svg: string, suffix: string): string {
  // Collect all id values
  const ids: string[] = [];
  svg.replace(/\bid="([^"]+)"/g, (_match, id) => {
    ids.push(id);
    return _match;
  });

  if (ids.length === 0) return svg;

  let result = svg;
  for (const id of ids) {
    const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const suffixed = `${id}-${suffix}`;
    // Replace definition: id="foo" → id="foo-s"
    result = result.replace(
      new RegExp(`\\bid="${escaped}"`, "g"),
      `id="${suffixed}"`,
    );
    // Replace url(#foo) references (in fill, stroke, clip-path, etc.)
    result = result.replace(
      new RegExp(`url\\(#${escaped}\\)`, "g"),
      `url(#${suffixed})`,
    );
    // Replace href="#foo" and xlink:href="#foo"
    result = result.replace(
      new RegExp(`href="#${escaped}"`, "g"),
      `href="#${suffixed}"`,
    );
  }

  return result;
}
