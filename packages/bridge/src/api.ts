/**
 * Typed TypeScript API over the SVG OS WASM module.
 *
 * Every function is a thin wrapper that serializes arguments
 * and deserializes results to/from the WASM flat API.
 */

import { getWasm } from "./wasm-loader.js";
import type { NodeId, SvgTagName, AttrMap, SvgDomOp, Effect, Constraint, Binding, Theme } from "./types.js";

// ── Document operations ─────────────────────────────────────────────────────

/** Import an SVG string, replacing the current document. */
export function importSvg(svg: string): void {
  getWasm().svg_os_import_svg(svg);
}

/** Export the current document as an SVG string. */
export function exportSvg(): string {
  return getWasm().svg_os_export_svg();
}

/** Get the root <svg> node ID. */
export function rootId(): NodeId {
  return getWasm().svg_os_root_id();
}

/** Get the <defs> node ID. */
export function defsId(): NodeId {
  return getWasm().svg_os_defs_id();
}

// ── Node operations ─────────────────────────────────────────────────────────

/** Create a new node. Returns the new node's ID. */
export function createNode(parentId: NodeId, tag: SvgTagName, attrs?: AttrMap): NodeId {
  const attrsJson = attrs ? JSON.stringify(attrs) : "";
  return getWasm().svg_os_create_node(parentId, tag, attrsJson);
}

/** Remove a node and its subtree. */
export function removeNode(id: NodeId): void {
  getWasm().svg_os_remove_node(id);
}

/** Set an attribute on a node. */
export function setAttr(id: NodeId, key: string, value: string): void {
  getWasm().svg_os_set_attr(id, key, value);
}

/** Remove an attribute from a node. */
export function removeAttr(id: NodeId, key: string): void {
  getWasm().svg_os_remove_attr(id, key);
}

/** Move a node to a new parent at the given index. */
export function reparent(id: NodeId, newParent: NodeId, index: number): void {
  getWasm().svg_os_reparent(id, newParent, index);
}

// ── Undo / Redo ─────────────────────────────────────────────────────────────

export function undo(): boolean { return getWasm().svg_os_undo(); }
export function redo(): boolean { return getWasm().svg_os_redo(); }
export function canUndo(): boolean { return getWasm().svg_os_can_undo(); }
export function canRedo(): boolean { return getWasm().svg_os_can_redo(); }

// ── Rendering ───────────────────────────────────────────────────────────────

/** Get pending DOM mutation operations as a typed array. */
export function getRenderOps(): SvgDomOp[] {
  const json = getWasm().svg_os_get_render_ops();
  return JSON.parse(json);
}

/** Reset the diff engine and return a complete render. Use after undo/redo or DOM clear. */
export function getFullRenderOps(): SvgDomOp[] {
  const json = getWasm().svg_os_full_render();
  return JSON.parse(json);
}

/** Get the full document as JSON (for debugging). */
export function getDocumentJson(): unknown {
  return JSON.parse(getWasm().svg_os_get_document_json());
}

// ── Effects ─────────────────────────────────────────────────────────────────

/** Add a non-destructive effect to a node. */
export function addEffect(nodeId: NodeId, effect: Effect): void {
  getWasm().svg_os_add_effect(nodeId, JSON.stringify(effect));
}

/** Remove an effect by index from a node's effect stack. */
export function removeEffect(nodeId: NodeId, index: number): void {
  getWasm().svg_os_remove_effect(nodeId, index);
}

// ── Constraints ─────────────────────────────────────────────────────────────

/** Add a layout constraint. */
export function addConstraint(constraint: Constraint): void {
  getWasm().svg_os_add_constraint(JSON.stringify(constraint));
}

/** Solve all constraints, updating node positions. */
export function solveConstraints(): void {
  getWasm().svg_os_solve_constraints();
}

// ── Data binding ────────────────────────────────────────────────────────────

/** Register a data binding. */
export function bind(binding: Binding): void {
  getWasm().svg_os_bind(JSON.stringify(binding));
}

/** Evaluate all bindings with the given data. */
export function evaluateBindings(data: Record<string, unknown>): void {
  getWasm().svg_os_evaluate_bindings(JSON.stringify(data));
}

// ── Themes ──────────────────────────────────────────────────────────────────

/** Apply a theme to the document. */
export function applyTheme(theme: Theme): void {
  getWasm().svg_os_apply_theme(JSON.stringify(theme));
}

// ── Templates ───────────────────────────────────────────────────────────────

/** Instantiate a template with data. Returns the new node ID. */
export function instantiateTemplate(templateId: NodeId, data: Record<string, unknown>): NodeId {
  return getWasm().svg_os_instantiate_template(templateId, JSON.stringify(data));
}

/** Repeat a template for each data row in a grid. Returns array of new node IDs. */
export function repeatTemplate(
  templateId: NodeId,
  rows: Record<string, unknown>[],
  columns: number,
  gapX: number,
  gapY: number,
): NodeId[] {
  const json = getWasm().svg_os_repeat_template(templateId, JSON.stringify(rows), columns, gapX, gapY);
  return JSON.parse(json);
}

/** Export a single node's subtree as SVG. */
export function exportNodeSvg(nodeId: NodeId): string {
  return getWasm().svg_os_export_node_svg(nodeId);
}
