/**
 * Typed TypeScript API over the SVG OS WASM module.
 *
 * Every function is a thin wrapper that serializes arguments
 * and deserializes results to/from the WASM flat API.
 */

import { getWasm } from "./wasm-loader.js";
import type { NodeId, SvgTagName, AttrMap, SvgDomOp, Effect, Constraint, Binding, Theme, Port, ConnectorDef, ConnectorInfo } from "./types.js";

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

/** Set multiple attributes as a single undoable batch. */
export function setAttrsBatch(id: NodeId, attrs: Record<string, string>): void {
  getWasm().svg_os_set_attrs_batch(id, JSON.stringify(attrs));
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

// ── Phase 3: Clone, group/ungroup, node info ────────────────────────────────

/** Clone a node subtree. Returns the new root node ID. */
export function cloneNode(id: NodeId): NodeId {
  return getWasm().svg_os_clone_node(id);
}

/** Group multiple nodes into a new <g> element. Returns the group's ID. */
export function groupNodes(ids: NodeId[]): NodeId {
  return getWasm().svg_os_group_nodes(JSON.stringify(ids));
}

/** Ungroup: move children of a <g> to its parent, remove the <g>. */
export function ungroupNode(groupId: NodeId): void {
  getWasm().svg_os_ungroup(groupId);
}

/** Get info about a node (tag, attrs, children) as a parsed object. */
export function getNodeInfo(id: NodeId): { tag: string; attrs: Record<string, string>; children: string[]; visible: boolean; locked: boolean; name: string | null } {
  return JSON.parse(getWasm().svg_os_get_node_info(id));
}

// ── Diagram: Ports & Connectors ─────────────────────────────────────────────

/** Set ports on a node. */
export function addPorts(nodeId: NodeId, ports: Port[]): void {
  getWasm().svg_os_add_ports(nodeId, JSON.stringify(ports));
}

/** Add default cardinal ports (top, right, bottom, left) to a node. */
export function addDefaultPorts(nodeId: NodeId): void {
  getWasm().svg_os_add_default_ports(nodeId);
}

/** Get ports for a node. */
export function getPorts(nodeId: NodeId): Port[] {
  return JSON.parse(getWasm().svg_os_get_ports(nodeId));
}

/** Add a connector between two ports. Returns the path node ID. */
export function addConnector(def: ConnectorDef): NodeId {
  return getWasm().svg_os_add_connector(JSON.stringify(def));
}

/** Remove a connector by its path node ID. */
export function removeConnector(pathNodeId: NodeId): void {
  getWasm().svg_os_remove_connector(pathNodeId);
}

/** Recompute all connector paths from current node positions. */
export function updateConnectors(): void {
  getWasm().svg_os_update_connectors();
}

/** Get all registered connectors. */
export function getConnectors(): ConnectorInfo[] {
  return JSON.parse(getWasm().svg_os_get_connectors());
}

/** Auto-layout all diagram nodes using Sugiyama layered algorithm. */
export function autoLayout(config: {
  direction?: "TopToBottom" | "LeftToRight";
  nodeGap?: number;
  layerGap?: number;
}): void {
  getWasm().svg_os_auto_layout(JSON.stringify(config));
}

/** Generate a diagram from graph JSON data. Creates nodes + connectors + layout. */
export function generateDiagram(
  data: { nodes: Array<{ id: string; label: string; type?: string }>; edges: Array<{ from: string; to: string; label?: string }> },
  config?: { direction?: "TopToBottom" | "LeftToRight"; nodeGap?: number; layerGap?: number },
): { nodeMap: Record<string, string>; connectorCount: number } {
  return JSON.parse(getWasm().svg_os_generate_diagram(JSON.stringify(data), JSON.stringify(config ?? {})));
}

// ── Node Type Registry ───────────────────────────────────────────────────────

export function registerNodeType(def: {
  id: string;
  name: string;
  category?: string;
  template_svg: string;
  icon?: string;
}): void {
  getWasm().svg_os_register_node_type(JSON.stringify(def));
}

export function listNodeTypes(): Array<{
  id: string;
  name: string;
  category: string;
  slots: Array<{ field: string; bind_type: string; target_attr: string }>;
  default_width: number;
  default_height: number;
}> {
  return JSON.parse(getWasm().svg_os_list_node_types());
}

export function getNodeType(typeId: string): unknown {
  return JSON.parse(getWasm().svg_os_get_node_type(typeId));
}

export function instantiateNodeType(
  typeId: string,
  x: number,
  y: number,
  data?: Record<string, unknown>,
): string {
  return getWasm().svg_os_instantiate_node_type(typeId, x, y, JSON.stringify(data ?? {}));
}

// ── Inline template rendering ────────────────────────────────────────────────

/** Resolve data-bind attributes in an SVG template string synchronously.
 *  Does not require Engine state — useful for re-rendering templates on data change. */
export function renderTemplateInline(templateSvg: string, data: Record<string, unknown>): string {
  return getWasm().svg_os_render_template_inline(templateSvg, JSON.stringify(data));
}

// ── Data Flow ────────────────────────────────────────────────────────────────

export function evaluateDataFlow(data?: Record<string, unknown>): void {
  getWasm().svg_os_evaluate_data_flow(JSON.stringify(data ?? {}));
}

export function getNodeData(nodeId: string): unknown {
  return JSON.parse(getWasm().svg_os_get_node_data(nodeId));
}

// ── AI Context ────────────────────────────────────────────────────────────────

import type { GraphManifest, NodeContext, ConnectionSuggestion, NodeRole, PendingAiEval } from "./types.js";

/** Get a compact semantic map of the entire document graph. */
export function getGraphManifest(): GraphManifest {
  return JSON.parse(getWasm().svg_os_get_graph_manifest());
}

/** Get focused context for a single node. */
export function getNodeContext(nodeId: string): NodeContext | null {
  return JSON.parse(getWasm().svg_os_get_node_context(nodeId));
}

/** Get connection suggestions for linking two nodes. */
export function suggestConnection(fromId: string, toId: string): ConnectionSuggestion {
  return JSON.parse(getWasm().svg_os_suggest_connection(fromId, toId));
}

/** Set the semantic role of a node. */
export function setNodeRole(nodeId: string, role: NodeRole): void {
  getWasm().svg_os_set_node_role(nodeId, role);
}

/** Get pending AI evaluations that need external resolution. */
export function getPendingAiEvals(): PendingAiEval[] {
  return JSON.parse(getWasm().svg_os_get_pending_ai_evals());
}

/** Resolve an AI evaluation with result data. */
export function resolveAiEval(nodeId: string, result: unknown): void {
  getWasm().svg_os_resolve_ai_eval(nodeId, JSON.stringify(result));
}

/** Set node data directly (for external data injection). */
export function setNodeData(nodeId: string, data: unknown): void {
  getWasm().svg_os_set_node_data(nodeId, JSON.stringify(data));
}
