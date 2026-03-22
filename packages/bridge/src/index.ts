/**
 * @svg-os/bridge — TypeScript wrapper for the SVG OS WASM engine.
 *
 * Usage:
 *   import { loadWasm, createNode, getRenderOps, applyOps } from "@svg-os/bridge";
 *   await loadWasm();
 *   const rectId = createNode(rootId(), "rect", { x: "10", y: "10", width: "100", height: "50", fill: "red" });
 *   const ops = getRenderOps();
 *   applyOps(document.getElementById("canvas")!, ops);
 */

export { loadWasm, getWasm } from "./wasm-loader.js";
export type { SvgOsWasm } from "./wasm-loader.js";

export {
  importSvg, exportSvg, rootId, defsId,
  createNode, removeNode, setAttr, setAttrsBatch, removeAttr, reparent,
  undo, redo, canUndo, canRedo,
  getRenderOps, getFullRenderOps, getDocumentJson,
  addEffect, removeEffect,
  addConstraint, solveConstraints,
  bind, evaluateBindings,
  applyTheme,
  instantiateTemplate, repeatTemplate, exportNodeSvg,
  cloneNode, groupNodes, ungroupNode, getNodeInfo,
  addPorts, addDefaultPorts, getPorts,
  addConnector, removeConnector, updateConnectors, getConnectors,
  autoLayout, generateDiagram,
  registerNodeType, listNodeTypes, getNodeType, instantiateNodeType,
  evaluateDataFlow, getNodeData,
} from "./api.js";

export { applyOps, resetElementMap, getElement } from "./dom-apply.js";

export type {
  NodeId, SvgTagName, AttrMap, SvgDomOp,
  Effect, Constraint, Binding, Theme,
  Port, PortDirection, ConnectorDef, ConnectorRouting, ConnectorInfo,
} from "./types.js";
