/**
 * WASM-powered card rendering via the SVG OS engine.
 *
 * Uses the Rust runtime's binding engine to resolve data bindings,
 * then renders via the diff-based DOM mutation pipeline.
 *
 * Discovery: The Rust parser maps all `data-*` custom attributes to a single
 * `data-custom` key. We disambiguate by element tag: text elements use
 * `data-text-content` binding, non-text elements use `fill` binding.
 */

import {
  importSvg,
  rootId,
  bind, evaluateBindings,
  getFullRenderOps, applyOps, resetElementMap,
  getNodeInfo,
} from "@svg-os/bridge";
import type { Binding } from "@svg-os/bridge";

interface BindableNode {
  nodeId: string;
  field: string;
  attr: string;
}

/**
 * Render a single card via the WASM engine.
 */
export function renderCardViaWasm(
  templateSvg: string,
  rowData: Record<string, unknown>,
  columnMap: Record<string, string>,
  container: Element,
): boolean {
  try {
    resetElementMap();
    importSvg(templateSvg);

    // Walk tree via getNodeInfo to find nodes with data-custom (= data-bind/data-bind-fill)
    const root = rootId();
    const bindableNodes: BindableNode[] = [];
    walkTree(root, bindableNodes);

    // Build mapped data
    const mappedData: Record<string, unknown> = {};
    for (const [slotField, dataColumn] of Object.entries(columnMap)) {
      mappedData[slotField] = rowData[dataColumn];
    }
    for (const [key, value] of Object.entries(rowData)) {
      if (!(key in mappedData)) {
        mappedData[key] = value;
      }
    }

    // Register bindings
    for (const node of bindableNodes) {
      const binding: Binding = {
        source: { Static: { value: mappedData } },
        target: node.nodeId,
        mappings: [{ field: node.field, attr: node.attr }],
      };
      bind(binding);
    }

    evaluateBindings(mappedData);

    const ops = getFullRenderOps();
    container.innerHTML = "";
    applyOps(container as HTMLElement, ops);

    console.log(`[SVG OS Engine] Rendered card with ${bindableNodes.length} bindings`);
    return true;
  } catch (err) {
    console.warn("[SVG OS Engine] WASM render failed, falling back to DOM:", err);
    return false;
  }
}

/** Text element tags where data-custom means text content binding. */
const TEXT_TAGS = new Set(["text", "tspan"]);

/**
 * Recursively walk the WASM tree. The Rust engine maps `data-bind="field"`
 * and `data-bind-fill="field"` to `data-custom: "field"` in attrs.
 * We disambiguate: text/tspan → text content binding, others → fill binding.
 */
function walkTree(nodeId: string, results: BindableNode[]): void {
  try {
    const info = getNodeInfo(nodeId);
    if (!info) return;

    const dataCustom = info.attrs?.["data-custom"];
    if (dataCustom && typeof dataCustom === "string") {
      if (TEXT_TAGS.has(info.tag)) {
        // Text element: data-bind="field" → text content binding
        results.push({
          nodeId,
          field: dataCustom,
          attr: "data-text-content",
        });
      } else {
        // Non-text element: data-bind-fill="field" → fill binding
        results.push({
          nodeId,
          field: dataCustom,
          attr: "fill",
        });
      }
    }

    if (info.children && Array.isArray(info.children)) {
      for (const childId of info.children) {
        walkTree(childId, results);
      }
    }
  } catch {
    // Skip inaccessible nodes
  }
}
