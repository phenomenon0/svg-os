/**
 * DOM Applicator: takes SvgDomOp arrays and applies them to a real <svg> element.
 *
 * This is the bridge between the Rust diff engine and the browser's SVG DOM.
 * The Rust side computes what changed; this module makes it happen in the DOM.
 */

import type { SvgDomOp } from "./types.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const XLINK_NS = "http://www.w3.org/1999/xlink";

/** Map of node IDs → DOM elements for fast lookup. */
const elementMap = new Map<string, Element>();

/**
 * Apply an array of DOM mutation operations to a container element.
 *
 * On first call, the container should be empty — the full_render ops
 * will create the root <svg> element inside it.
 */
export function applyOps(container: Element, ops: SvgDomOp[]): void {
  for (const op of ops) {
    switch (op.op) {
      case "CreateElement": {
        const el = document.createElementNS(SVG_NS, op.tag);
        el.setAttribute("data-node-id", op.id);
        elementMap.set(op.id, el);

        const parent = op.parent ? elementMap.get(op.parent) : container;
        if (parent) {
          const children = parent.children;
          if (op.index < children.length) {
            parent.insertBefore(el, children[op.index]);
          } else {
            parent.appendChild(el);
          }
        }
        break;
      }

      case "RemoveElement": {
        const el = elementMap.get(op.id);
        if (el) {
          el.remove();
          elementMap.delete(op.id);
        }
        break;
      }

      case "SetAttribute": {
        const el = elementMap.get(op.id);
        if (el) {
          if (op.key === "href" || op.key === "xlink:href") {
            el.setAttributeNS(XLINK_NS, "href", op.value);
          } else {
            el.setAttribute(op.key, op.value);
          }
        }
        break;
      }

      case "RemoveAttribute": {
        const el = elementMap.get(op.id);
        if (el) {
          el.removeAttribute(op.key);
        }
        break;
      }

      case "ReorderChildren": {
        const parent = elementMap.get(op.parent);
        if (parent) {
          // Detach all children, re-append in new order
          const fragment = document.createDocumentFragment();
          for (const childId of op.order) {
            const child = elementMap.get(childId);
            if (child) fragment.appendChild(child);
          }
          // Clear existing children that are in the order list
          parent.appendChild(fragment);
        }
        break;
      }

      case "SetTextContent": {
        const el = elementMap.get(op.id);
        if (el) {
          el.textContent = op.text;
        }
        break;
      }
    }
  }
}

/**
 * Clear the element map (call when reinitializing the document).
 */
export function resetElementMap(): void {
  elementMap.clear();
}

/**
 * Get a DOM element by its node ID.
 */
export function getElement(nodeId: string): Element | undefined {
  return elementMap.get(nodeId);
}
