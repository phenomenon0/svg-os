/**
 * SVG OS Editor — Phase 3: Group/ungroup, copy/paste, duplicate,
 * resize handles, grid snapping.
 */

import {
  loadWasm,
  rootId, defsId, createNode, removeNode, setAttr, setAttrsBatch,
  undo, redo, canUndo, canRedo,
  getRenderOps, getFullRenderOps, applyOps, resetElementMap,
  importSvg, exportSvg, getElement,
  bind, evaluateBindings, applyTheme, repeatTemplate,
  cloneNode, groupNodes, ungroupNode,
  addDefaultPorts, getPorts, addConnector, removeConnector, updateConnectors, autoLayout,
  generateDiagram, getNodeInfo,
  instantiateNodeType,
  evaluateDataFlow,
} from "@svg-os/bridge";
import type { Binding, Theme, Port } from "@svg-os/bridge";
import { initPalette, getPlacingType, placeNode, cancelPlacing } from "./node-palette.js";
import { showConnectionAssistant, dismissAssistant } from "./connection-assistant.js";

// ── State ───────────────────────────────────────────────────────────────────

type Tool = "select" | "rect" | "ellipse" | "path" | "text" | "diagram-node" | "connector";

let currentTool: Tool = "select";
let selectedNodeId: string | null = null;
let isDragging = false;
let isPanning = false;
let isResizing = false;
let resizeHandle: string | null = null;
let resizeStart = { x: 0, y: 0 };
let resizeNodeStart = { x: 0, y: 0, w: 0, h: 0 };
let dragStart = { x: 0, y: 0 };
let dragNodeStart = { x: 0, y: 0 };
let panStart = { x: 0, y: 0 };
let viewTransform = { x: 0, y: 0, scale: 1 };
let loadedData: unknown = null;
let activeBindings: Array<{ nodeId: string; field: string; attr: string }> = [];
let clipboardNodeId: string | null = null;
let gridSnap = false;
let gridSize = 8;
let isConnecting = false;
let connectorSource: { nodeId: string; portName: string; pt: { x: number; y: number } } | null = null;
let arrowheadCreated = false;

// Cached DOM refs for ensureCanvasGrid (populated on first call)
let cachedBg: SVGRectElement | null = null;
let cachedGrid: SVGRectElement | null = null;

const container = document.getElementById("canvas-container")!;
const statusText = document.getElementById("status-text")!;
const statusNodes = document.getElementById("status-nodes")!;
const statusZoom = document.getElementById("status-zoom")!;
const propContent = document.getElementById("prop-content")!;

// ── Grid snapping ────────────────────────────────────────────────────────────

function snap(v: number): number {
  return gridSnap ? Math.round(v / gridSize) * gridSize : Math.round(v);
}

// ── Init ────────────────────────────────────────────────────────────────────

async function init() {
  try {
    await loadWasm();
    statusText.textContent = "Ready";
    render();
    setupTools();
    setupKeyboard();
    setupCanvasEvents();
    setupPanelTabs();
    setupDataPanel();
    updateUndoRedoButtons();
    setupNodePalette();

    // Seed demo content when loaded with ?demo=true
    if (new URLSearchParams(window.location.search).has("demo")) {
      seedDemoContent();
    }

    // Expose AI-queryable global API for agents/devtools
    (window as any).svgOs = {
      /** Get current viewport state. */
      getViewport: () => {
        const rect = container.getBoundingClientRect();
        const vbW = rect.width / viewTransform.scale;
        const vbH = rect.height / viewTransform.scale;
        const vbX = -viewTransform.x / viewTransform.scale;
        const vbY = -viewTransform.y / viewTransform.scale;
        return {
          panX: viewTransform.x,
          panY: viewTransform.y,
          zoom: viewTransform.scale,
          viewBox: { x: vbX, y: vbY, width: vbW, height: vbH },
          canvasWidth: rect.width,
          canvasHeight: rect.height,
        };
      },
      /** Pan to center on a document coordinate. */
      panTo: (docX: number, docY: number) => {
        const rect = container.getBoundingClientRect();
        viewTransform.x = -(docX * viewTransform.scale - rect.width / 2);
        viewTransform.y = -(docY * viewTransform.scale - rect.height / 2);
        applyViewTransform();
      },
      /** Set zoom level (1.0 = 100%). */
      setZoom: (level: number) => {
        viewTransform.scale = Math.max(0.1, Math.min(10, level));
        applyViewTransform();
      },
      /** Zoom to fit all content. */
      zoomToFit: () => {
        // Trigger the existing Ctrl+0 / "Zoom to Fit" behavior
        viewTransform = { x: 0, y: 0, scale: 1 };
        applyViewTransform();
      },
      /** Get selected node ID. */
      getSelectedNode: () => selectedNodeId,
      /** Get current tool. */
      getCurrentTool: () => currentTool,
    };
  } catch (e) {
    statusText.textContent = `Failed to load WASM: ${e}`;
    console.error(e);
  }
}

/**
 * Seed the editor with a small starter diagram for the demo experience.
 * Creates 3 connected diagram nodes + a floating tooltip.
 */
function seedDemoContent() {
  const root = rootId();

  // Create 3 diagram nodes as groups with rect + text
  const nodeData = [
    { label: "Frontend", x: 100, y: 80 },
    { label: "API Server", x: 300, y: 80 },
    { label: "Database", x: 200, y: 240 },
  ];

  const nodeIds: string[] = [];
  for (const nd of nodeData) {
    const g = createNode(root, "g", { transform: `translate(${nd.x}, ${nd.y})` });
    createNode(g, "rect", {
      x: "0", y: "0", width: "140", height: "50",
      rx: "8", ry: "8",
      fill: "#1e3a5f", stroke: "#3b82f6", "stroke-width": "2",
    });
    createNode(g, "text", {
      x: "70", y: "30",
      "text-anchor": "middle",
      fill: "#93c5fd",
      "font-family": "Inter, system-ui, sans-serif",
      "font-size": "13",
      "font-weight": "500",
    });
    // Set text content via setAttr (the WASM engine handles TextContent)
    const textId = (() => {
      const info = getNodeInfo(g);
      return info.children[info.children.length - 1];
    })();
    setAttr(textId, "TextContent", nd.label);

    addDefaultPorts(g);
    nodeIds.push(g);
  }

  // Connect: Frontend → API Server, API Server → Database
  addConnector({ from: [nodeIds[0], "right"], to: [nodeIds[1], "left"], routing: "Orthogonal" });
  addConnector({ from: [nodeIds[1], "bottom"], to: [nodeIds[2], "top"], routing: "Orthogonal" });
  updateConnectors();

  // Full re-render to show everything
  fullRerender();

  // Show a floating tooltip
  const tooltip = document.createElement("div");
  tooltip.style.cssText = `
    position: fixed; top: 72px; left: 50%; transform: translateX(-50%);
    background: #1e293b; border: 1px solid #3b82f6; border-radius: 8px;
    padding: 10px 18px; color: #93c5fd; font-size: 13px; z-index: 100;
    box-shadow: 0 4px 16px rgba(59, 130, 246, 0.2);
    font-family: Inter, system-ui, sans-serif;
    pointer-events: none; opacity: 0; transition: opacity 0.5s;
  `;
  tooltip.textContent = "Press N to add a node, W to wire, click Layout to auto-arrange";
  document.body.appendChild(tooltip);
  requestAnimationFrame(() => { tooltip.style.opacity = "1"; });
  setTimeout(() => {
    tooltip.style.opacity = "0";
    setTimeout(() => tooltip.remove(), 500);
  }, 6000);
}

// ── Rendering ───────────────────────────────────────────────────────────────

function render() {
  const ops = getRenderOps();
  applyOps(container, ops);
  applyViewTransform();
  updateStatus();
}

function fullRerender() {
  container.innerHTML = "";
  resetElementMap();
  const ops = getFullRenderOps();
  applyOps(container, ops);
  applyViewTransform();
  deselectNode();
  updateStatus();
  updateLayers();
}

function applyViewTransform() {
  const svg = container.querySelector("svg") as SVGSVGElement | null;
  if (!svg) return;

  // Infinite canvas: use viewBox for pan/zoom instead of CSS transform
  const rect = container.getBoundingClientRect();
  const vbW = rect.width / viewTransform.scale;
  const vbH = rect.height / viewTransform.scale;
  const vbX = -viewTransform.x / viewTransform.scale;
  const vbY = -viewTransform.y / viewTransform.scale;
  svg.setAttribute("viewBox", `${vbX} ${vbY} ${vbW} ${vbH}`);
  svg.setAttribute("width", `${rect.width}`);
  svg.setAttribute("height", `${rect.height}`);
  svg.style.transform = "";
  svg.style.width = "100%";
  svg.style.height = "100%";

  // Ensure infinite canvas grid pattern exists
  ensureCanvasGrid(svg, vbX, vbY, vbW, vbH);
}

function ensureCanvasGrid(svg: SVGSVGElement, vbX: number, vbY: number, vbW: number, vbH: number) {
  // Use cached refs; fall back to querySelector if invalidated
  let bg = cachedBg && cachedBg.isConnected ? cachedBg : svg.querySelector("[data-canvas-bg]") as SVGRectElement | null;
  let grid = cachedGrid && cachedGrid.isConnected ? cachedGrid : svg.querySelector("[data-canvas-grid]") as SVGRectElement | null;

  if (!bg) {
    // Create grid pattern in defs
    let defs = svg.querySelector("defs");
    if (!defs) {
      defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
      svg.prepend(defs);
    }

    // Grid pattern: dots at 20px intervals + faint lines at 100px
    let gridPattern = defs.querySelector("#canvas-grid-pattern") as SVGPatternElement | null;
    if (!gridPattern) {
      gridPattern = document.createElementNS("http://www.w3.org/2000/svg", "pattern") as SVGPatternElement;
      gridPattern.id = "canvas-grid-pattern";
      gridPattern.setAttribute("width", "100");
      gridPattern.setAttribute("height", "100");
      gridPattern.setAttribute("patternUnits", "userSpaceOnUse");

      // Major grid lines every 100px
      const hLine = document.createElementNS("http://www.w3.org/2000/svg", "line");
      hLine.setAttribute("x1", "0"); hLine.setAttribute("y1", "0");
      hLine.setAttribute("x2", "100"); hLine.setAttribute("y2", "0");
      hLine.setAttribute("stroke", "#1e293b"); hLine.setAttribute("stroke-width", "0.5");
      gridPattern.appendChild(hLine);

      const vLine = document.createElementNS("http://www.w3.org/2000/svg", "line");
      vLine.setAttribute("x1", "0"); vLine.setAttribute("y1", "0");
      vLine.setAttribute("x2", "0"); vLine.setAttribute("y2", "100");
      vLine.setAttribute("stroke", "#1e293b"); vLine.setAttribute("stroke-width", "0.5");
      gridPattern.appendChild(vLine);

      // Dots at 20px intervals
      for (let gx = 0; gx < 100; gx += 20) {
        for (let gy = 0; gy < 100; gy += 20) {
          const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
          dot.setAttribute("cx", `${gx}`);
          dot.setAttribute("cy", `${gy}`);
          dot.setAttribute("r", "0.8");
          dot.setAttribute("fill", "#283548");
          gridPattern.appendChild(dot);
        }
      }

      defs.appendChild(gridPattern);
    }

    // Background rect
    bg = document.createElementNS("http://www.w3.org/2000/svg", "rect") as SVGRectElement;
    bg.setAttribute("data-canvas-bg", "true");
    bg.setAttribute("fill", "#0c1220");
    // Insert before all other content (after defs)
    const firstContent = svg.querySelector(":scope > :not(defs)");
    if (firstContent) {
      svg.insertBefore(bg, firstContent);
    } else {
      svg.appendChild(bg);
    }

    // Grid rect
    grid = document.createElementNS("http://www.w3.org/2000/svg", "rect") as SVGRectElement;
    grid.setAttribute("data-canvas-grid", "true");
    grid.setAttribute("fill", "url(#canvas-grid-pattern)");
    svg.insertBefore(grid, bg.nextSibling);
  }

  // Cache refs for subsequent calls
  cachedBg = bg;
  cachedGrid = grid;

  // Update bg and grid to cover current viewBox with margin
  const margin = 200;
  const attrs = {
    x: `${vbX - margin}`,
    y: `${vbY - margin}`,
    width: `${vbW + margin * 2}`,
    height: `${vbH + margin * 2}`,
  };
  for (const [k, v] of Object.entries(attrs)) {
    bg!.setAttribute(k, v);
    grid!.setAttribute(k, v);
  }
}

function updateStatus() {
  const svg = container.querySelector("svg");
  if (svg) {
    const count = svg.querySelectorAll("*:not([data-selection]):not([data-handle])").length;
    statusNodes.textContent = `${count} elements`;
  }
  statusZoom.textContent = `${Math.round(viewTransform.scale * 100)}%`;
  const snapStatus = document.getElementById("status-snap");
  if (snapStatus) snapStatus.textContent = gridSnap ? `Snap: ${gridSize}px` : "";
  updateUndoRedoButtons();
}

function updateUndoRedoButtons() {
  (document.getElementById("btn-undo") as HTMLButtonElement).disabled = !canUndo();
  (document.getElementById("btn-redo") as HTMLButtonElement).disabled = !canRedo();
}

// ── Panel Tabs ──────────────────────────────────────────────────────────────

function setupPanelTabs() {
  document.querySelectorAll(".panel-tabs button").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tab = (btn as HTMLElement).dataset.tab;
      document.querySelectorAll(".panel-tabs button").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      document.querySelectorAll(".panel-content").forEach((p) => {
        (p as HTMLElement).hidden = p.id !== `tab-${tab}`;
      });
      if (tab === "layers") updateLayers();
    });
  });
}

// ── Tools ───────────────────────────────────────────────────────────────────

function setupTools() {
  const tools: Tool[] = ["select", "rect", "ellipse", "path", "text", "diagram-node", "connector"];
  for (const tool of tools) {
    document.getElementById(`tool-${tool}`)?.addEventListener("click", () => setTool(tool));
  }

  document.getElementById("btn-undo")!.addEventListener("click", () => { undo(); fullRerender(); });
  document.getElementById("btn-redo")!.addEventListener("click", () => { redo(); fullRerender(); });

  document.getElementById("btn-export")!.addEventListener("click", () => {
    const svg = exportSvg();
    const blob = new Blob([svg], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "svg-os-export.svg"; a.click();
    URL.revokeObjectURL(url);
  });

  document.getElementById("btn-import")!.addEventListener("click", () => {
    const input = document.createElement("input");
    input.type = "file"; input.accept = ".svg";
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (file) { importSvg(await file.text()); fullRerender(); }
    });
    input.click();
  });

  // Theme cycling
  let themeIdx = 0;
  const themes: Theme[] = [
    { name: "default", colors: { primary: "#2563eb", secondary: "#64748b", background: "#ffffff", foreground: "#0f172a", accent: "#f59e0b" }, fonts: { heading: "Inter, sans-serif", body: "Inter, sans-serif" }, spacing: { sm: 8, md: 16, lg: 24 } },
    { name: "catppuccin", colors: { primary: "#89b4fa", secondary: "#a6adc8", background: "#1e1e2e", foreground: "#cdd6f4", accent: "#f9e2af" }, fonts: { heading: "Inter, sans-serif", body: "Inter, sans-serif" }, spacing: { sm: 8, md: 16, lg: 24 } },
    { name: "warm", colors: { primary: "#ea580c", secondary: "#78716c", background: "#fef3c7", foreground: "#292524", accent: "#dc2626" }, fonts: { heading: "Georgia, serif", body: "Inter, sans-serif" }, spacing: { sm: 8, md: 16, lg: 24 } },
  ];
  document.getElementById("btn-theme")!.addEventListener("click", () => {
    themeIdx = (themeIdx + 1) % themes.length;
    applyTheme(themes[themeIdx]);
    fullRerender();
    statusText.textContent = `Theme: ${themes[themeIdx].name}`;
  });

  // Grid snap toggle
  document.getElementById("btn-snap")?.addEventListener("click", () => {
    gridSnap = !gridSnap;
    const btn = document.getElementById("btn-snap")!;
    btn.classList.toggle("active", gridSnap);
    statusText.textContent = gridSnap ? `Grid snap ON (${gridSize}px)` : "Grid snap OFF";
    updateStatus();
  });

  // Auto-layout button
  document.getElementById("btn-layout")?.addEventListener("click", () => {
    autoLayout({ direction: "TopToBottom", nodeGap: 40, layerGap: 80 });
    fullRerender();
    statusText.textContent = "Layout applied";
  });
}

// ── Keyboard ────────────────────────────────────────────────────────────────

function setupKeyboard() {
  document.addEventListener("keydown", (e) => {
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

    if (e.key === "Escape") {
      cancelPlacing();
      container.style.cursor = "";
      return;
    }

    if (!e.ctrlKey && !e.metaKey) {
      switch (e.key.toLowerCase()) {
        case "v": setTool("select"); return;
        case "r": setTool("rect"); return;
        case "e": setTool("ellipse"); return;
        case "p": setTool("path"); return;
        case "t": setTool("text"); return;
        case "n": setTool("diagram-node"); return;
        case "w": setTool("connector"); return;
        case "delete": case "backspace":
          if (selectedNodeId) { removeNode(selectedNodeId); selectedNodeId = null; fullRerender(); }
          return;
        case "0":
          viewTransform = { x: 0, y: 0, scale: 1 };
          applyViewTransform();
          updateStatus();
          return;
      }
    }

    // Ctrl/Cmd shortcuts
    if (e.ctrlKey || e.metaKey) {
      switch (e.key.toLowerCase()) {
        case "z":
          e.preventDefault();
          if (e.shiftKey) { redo(); } else { undo(); }
          fullRerender();
          return;
        case "y":
          e.preventDefault();
          redo();
          fullRerender();
          return;
        case "=": case "+":
          e.preventDefault();
          zoom(1.2);
          return;
        case "-":
          e.preventDefault();
          zoom(1 / 1.2);
          return;
        case "c": // Copy
          e.preventDefault();
          if (selectedNodeId) {
            clipboardNodeId = selectedNodeId;
            statusText.textContent = "Copied";
          }
          return;
        case "v": // Paste
          if (clipboardNodeId) {
            e.preventDefault();
            pasteNode();
          }
          return;
        case "d": // Duplicate
          e.preventDefault();
          if (selectedNodeId) duplicateNode();
          return;
        case "g": // Group / Ungroup
          e.preventDefault();
          if (e.shiftKey) {
            ungroupSelected();
          } else {
            groupSelected();
          }
          return;
      }
    }
  });
}

function setTool(tool: Tool) {
  currentTool = tool;
  document.querySelectorAll(".toolbar button[id^='tool-']").forEach((b) => b.classList.remove("active"));
  document.getElementById(`tool-${tool}`)?.classList.add("active");
  // Show port indicators when connector tool is active
  if (tool === "connector") {
    renderPortIndicators();
  } else {
    removePortIndicators();
  }
}

// ── Group / Ungroup ─────────────────────────────────────────────────────────

function groupSelected() {
  if (!selectedNodeId) return;
  const groupId = groupNodes([selectedNodeId]);
  fullRerender();
  // Re-select the new group after rerender
  setTimeout(() => selectNode(groupId), 0);
  statusText.textContent = "Grouped";
}

function ungroupSelected() {
  if (!selectedNodeId) return;
  const el = getElement(selectedNodeId);
  if (!el || el.tagName.toLowerCase() !== "g") {
    statusText.textContent = "Select a group to ungroup";
    return;
  }
  ungroupNode(selectedNodeId);
  fullRerender();
  statusText.textContent = "Ungrouped";
}

// ── Copy / Paste / Duplicate ────────────────────────────────────────────────

function pasteNode() {
  if (!clipboardNodeId) return;
  const newId = cloneNode(clipboardNodeId);
  // Offset pasted node by (20, 20) from original
  const el = getElement(clipboardNodeId);
  if (el) {
    const keys = posKeys(el);
    const origX = parseFloat(el.getAttribute(keys.x) || "0");
    const origY = parseFloat(el.getAttribute(keys.y) || "0");
    setAttrsBatch(newId, {
      [keys.x]: String(snap(origX + 20)),
      [keys.y]: String(snap(origY + 20)),
    });
  }
  fullRerender();
  setTimeout(() => selectNode(newId), 0);
  statusText.textContent = "Pasted";
}

function duplicateNode() {
  if (!selectedNodeId) return;
  const newId = cloneNode(selectedNodeId);
  const el = getElement(selectedNodeId);
  if (el) {
    const keys = posKeys(el);
    const origX = parseFloat(el.getAttribute(keys.x) || "0");
    const origY = parseFloat(el.getAttribute(keys.y) || "0");
    setAttrsBatch(newId, {
      [keys.x]: String(snap(origX + 20)),
      [keys.y]: String(snap(origY + 20)),
    });
  }
  fullRerender();
  setTimeout(() => selectNode(newId), 0);
  statusText.textContent = "Duplicated";
}

// ── Zoom / Pan ──────────────────────────────────────────────────────────────

function zoom(factor: number, cx?: number, cy?: number) {
  const rect = container.getBoundingClientRect();
  const centerX = cx ?? rect.width / 2;
  const centerY = cy ?? rect.height / 2;

  const oldScale = viewTransform.scale;
  const newScale = Math.min(Math.max(oldScale * factor, 0.1), 10);
  const ratio = newScale / oldScale;

  viewTransform.x = centerX - (centerX - viewTransform.x) * ratio;
  viewTransform.y = centerY - (centerY - viewTransform.y) * ratio;
  viewTransform.scale = newScale;

  applyViewTransform();
  updateStatus();
}

// ── Canvas Events ───────────────────────────────────────────────────────────

function setupCanvasEvents() {
  container.addEventListener("pointerdown", onPointerDown);
  container.addEventListener("pointermove", onPointerMove);
  container.addEventListener("pointerup", onPointerUp);
  container.addEventListener("wheel", onWheel, { passive: false });
}

function getSvgPoint(clientX: number, clientY: number): { x: number; y: number } {
  const svg = container.querySelector("svg") as SVGSVGElement | null;
  if (!svg) return { x: 0, y: 0 };
  const rect = svg.getBoundingClientRect();
  const viewBox = svg.viewBox.baseVal;
  if (!viewBox || viewBox.width === 0) return { x: clientX - rect.left, y: clientY - rect.top };
  return {
    x: (clientX - rect.left) * (viewBox.width / rect.width) + viewBox.x,
    y: (clientY - rect.top) * (viewBox.height / rect.height) + viewBox.y,
  };
}

function posKeys(el: Element) {
  const t = el.tagName.toLowerCase();
  return (t === "circle" || t === "ellipse") ? { x: "cx", y: "cy" } : { x: "x", y: "y" };
}

function onWheel(e: WheelEvent) {
  e.preventDefault();
  if (e.ctrlKey || e.metaKey) {
    const factor = e.deltaY > 0 ? 1 / 1.1 : 1.1;
    const rect = container.getBoundingClientRect();
    zoom(factor, e.clientX - rect.left, e.clientY - rect.top);
  } else {
    viewTransform.x -= e.deltaX;
    viewTransform.y -= e.deltaY;
    applyViewTransform();
    updateStatus();
  }
}

function onPointerDown(e: PointerEvent) {
  const pt = getSvgPoint(e.clientX, e.clientY);

  // Node palette placement mode
  if (getPlacingType() && e.button === 0) {
    try {
      const nodeId = placeNode(pt.x, pt.y);
      console.log(`[palette] placed ${getPlacingType()} → nodeId=${nodeId}`);
      if (nodeId) {
        fullRerender();
        selectNode(nodeId);
      }
    } catch (e) {
      console.error(`[palette] placement failed:`, e);
    }
    return;
  }

  // Middle mouse to pan
  if (e.button === 1) {
    isPanning = true;
    panStart = { x: e.clientX - viewTransform.x, y: e.clientY - viewTransform.y };
    container.setPointerCapture(e.pointerId);
    container.style.cursor = "grabbing";
    return;
  }

  // Check if clicking a resize handle
  const target = e.target as Element;
  const handleDir = target?.getAttribute?.("data-handle");
  if (handleDir && selectedNodeId) {
    isResizing = true;
    resizeHandle = handleDir;
    resizeStart = pt;
    const el = getElement(selectedNodeId);
    if (el) {
      const tag = el.tagName.toLowerCase();
      if (tag === "ellipse") {
        resizeNodeStart = {
          x: parseFloat(el.getAttribute("cx") || "0"),
          y: parseFloat(el.getAttribute("cy") || "0"),
          w: parseFloat(el.getAttribute("rx") || "0") * 2,
          h: parseFloat(el.getAttribute("ry") || "0") * 2,
        };
      } else {
        resizeNodeStart = {
          x: parseFloat(el.getAttribute("x") || "0"),
          y: parseFloat(el.getAttribute("y") || "0"),
          w: parseFloat(el.getAttribute("width") || "0"),
          h: parseFloat(el.getAttribute("height") || "0"),
        };
      }
    }
    container.setPointerCapture(e.pointerId);
    return;
  }

  if (currentTool === "select") {
    const nodeId = target?.getAttribute?.("data-node-id");
    if (nodeId && target.tagName !== "svg" && target.tagName !== "defs"
      && !target.hasAttribute("data-selection") && !target.hasAttribute("data-handle")) {
      selectNode(nodeId);
      isDragging = true;
      dragStart = pt;
      const keys = posKeys(target);
      dragNodeStart = { x: parseFloat(target.getAttribute(keys.x) || "0"), y: parseFloat(target.getAttribute(keys.y) || "0") };
      container.setPointerCapture(e.pointerId);
    } else if (!handleDir) {
      deselectNode();
    }
  } else if (currentTool === "text") {
    const root = rootId();
    const id = createNode(root, "text", {
      x: String(snap(pt.x)),
      y: String(snap(pt.y)),
      "font-family": "Inter, system-ui, sans-serif",
      "font-size": "18",
      fill: "#0f172a",
      "text-anchor": "start",
      "data-text-content": "Text",
    });
    render();
    selectNode(id);
    setTool("select");
    updateLayers();
  } else if (currentTool === "diagram-node") {
    // Create a diagram node: rect with label + default ports
    const root = rootId();
    const groupId = createNode(root, "g", {});
    const rectId = createNode(groupId, "rect", {
      x: String(snap(pt.x - 80)), y: String(snap(pt.y - 40)),
      width: "160", height: "80",
      fill: "#1e293b", stroke: "#475569", "stroke-width": "2", rx: "8",
    });
    createNode(groupId, "text", {
      x: String(snap(pt.x)), y: String(snap(pt.y + 5)),
      "font-family": "Inter, system-ui, sans-serif",
      "font-size": "14", fill: "#e2e8f0",
      "text-anchor": "middle",
      "data-text-content": "Node",
    });
    // Set position on the group using the rect's position
    setAttrsBatch(groupId, {
      x: String(snap(pt.x - 80)), y: String(snap(pt.y - 40)),
      width: "160", height: "80",
    });
    addDefaultPorts(groupId);
    ensureArrowheadMarker();
    render();
    selectNode(groupId);
    setTool("select");
    updateLayers();
  } else if (currentTool === "connector") {
    // Check if clicking near a port
    const hit = findNearestPort(pt, 16);
    if (hit) {
      isConnecting = true;
      connectorSource = { nodeId: hit.nodeId, portName: hit.port.name, pt: hit.worldPos };
      container.setPointerCapture(e.pointerId);
      showConnectorPreview(hit.worldPos, pt);
    }
  } else {
    const root = rootId();
    const s = 80;
    let id: string | undefined;

    if (currentTool === "rect") {
      id = createNode(root, "rect", {
        x: String(snap(pt.x - s/2)), y: String(snap(pt.y - s/2)),
        width: String(s), height: String(s), fill: "#3b82f6", stroke: "#1d4ed8", "stroke-width": "2", rx: "4",
      });
    } else if (currentTool === "ellipse") {
      id = createNode(root, "ellipse", {
        cx: String(snap(pt.x)), cy: String(snap(pt.y)),
        rx: String(s/2), ry: String(s/3), fill: "#8b5cf6", stroke: "#6d28d9", "stroke-width": "2",
      });
    } else if (currentTool === "path") {
      id = createNode(root, "path", {
        d: `M${snap(pt.x)},${snap(pt.y)} l60,-30 l0,60 Z`,
        fill: "#f59e0b", stroke: "#d97706", "stroke-width": "2",
      });
    }

    if (id) { render(); selectNode(id); }
    setTool("select");
    updateLayers();
  }
}

function onPointerMove(e: PointerEvent) {
  if (isPanning) {
    viewTransform.x = e.clientX - panStart.x;
    viewTransform.y = e.clientY - panStart.y;
    applyViewTransform();
    return;
  }
  if (isConnecting && connectorSource) {
    const pt = getSvgPoint(e.clientX, e.clientY);
    showConnectorPreview(connectorSource.pt, pt);
    return;
  }
  if (isResizing && selectedNodeId && resizeHandle) {
    const pt = getSvgPoint(e.clientX, e.clientY);
    const dx = pt.x - resizeStart.x;
    const dy = pt.y - resizeStart.y;
    applyResize(dx, dy);
    return;
  }
  if (!isDragging || !selectedNodeId) return;
  const pt = getSvgPoint(e.clientX, e.clientY);
  const el = getElement(selectedNodeId);
  if (!el) return;
  const keys = posKeys(el);
  el.setAttribute(keys.x, String(snap(dragNodeStart.x + pt.x - dragStart.x)));
  el.setAttribute(keys.y, String(snap(dragNodeStart.y + pt.y - dragStart.y)));
  updateSelectionOverlay();
}

function onPointerUp(e: PointerEvent) {
  if (isPanning) {
    isPanning = false;
    container.releasePointerCapture(e.pointerId);
    container.style.cursor = "";
    return;
  }
  if (isConnecting && connectorSource) {
    const pt = getSvgPoint(e.clientX, e.clientY);
    const hit = findNearestPort(pt, 16);
    if (hit && hit.nodeId !== connectorSource.nodeId) {
      const fromId = connectorSource.nodeId;
      const toId = hit.nodeId;
      const fromPort = connectorSource.portName;
      const toPort = hit.port.name;

      // Create connector with PassThrough as default
      const pathNodeId = addConnector({
        from: [fromId, fromPort],
        to: [toId, toPort],
        routing: "Straight",
        dataFlow: "PassThrough",
      });

      // Evaluate data flow so downstream nodes update
      try { evaluateDataFlow(); } catch { /* ignore if no bindings */ }
      render();

      // Show connection assistant popup
      showConnectionAssistant(fromId, toId, e.clientX, e.clientY, {
        onApply: (dataFlow) => {
          // If user picked something other than PassThrough, recreate connector
          if (dataFlow !== "PassThrough") {
            removeConnector(pathNodeId);
            addConnector({
              from: [fromId, fromPort],
              to: [toId, toPort],
              routing: "Straight",
              dataFlow,
            });
            try { evaluateDataFlow(); } catch { /* ignore */ }
            render();
          }
        },
        onDismiss: () => {
          // Keep the PassThrough connector as-is
        },
      });
    }
    isConnecting = false;
    connectorSource = null;
    removeConnectorPreview();
    container.releasePointerCapture(e.pointerId);
    return;
  }
  if (isResizing && selectedNodeId && resizeHandle) {
    const pt = getSvgPoint(e.clientX, e.clientY);
    const dx = pt.x - resizeStart.x;
    const dy = pt.y - resizeStart.y;
    commitResize(dx, dy);
    isResizing = false;
    resizeHandle = null;
    container.releasePointerCapture(e.pointerId);
    return;
  }
  if (!isDragging || !selectedNodeId) return;
  const pt = getSvgPoint(e.clientX, e.clientY);
  const dx = pt.x - dragStart.x, dy = pt.y - dragStart.y;

  if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
    const el = getElement(selectedNodeId);
    if (el) {
      const keys = posKeys(el);
      setAttrsBatch(selectedNodeId, {
        [keys.x]: String(snap(dragNodeStart.x + dx)),
        [keys.y]: String(snap(dragNodeStart.y + dy)),
      });
      updateConnectors();
      render();
    }
  }

  isDragging = false;
  container.releasePointerCapture(e.pointerId);
  updateUndoRedoButtons();
  if (selectedNodeId) showPropsFor(selectedNodeId);
}

// ── Diagram helpers: ports, connectors ───────────────────────────────────────

interface PortHit {
  nodeId: string;
  port: Port;
  worldPos: { x: number; y: number };
}

/** Find the nearest port to a point within maxDist pixels. */
function findNearestPort(pt: { x: number; y: number }, maxDist: number): PortHit | null {
  const svg = container.querySelector("svg");
  if (!svg) return null;

  let best: PortHit | null = null;
  let bestDist = maxDist;

  // Find all elements with data-node-id and check for ports
  const elements = svg.querySelectorAll("[data-node-id]");
  for (const el of elements) {
    const nodeId = el.getAttribute("data-node-id");
    if (!nodeId) continue;

    let ports: Port[];
    try {
      ports = getPorts(nodeId);
    } catch {
      continue;
    }
    if (ports.length === 0) continue;

    // Get element bounds
    const bbox = (el as SVGGraphicsElement).getBBox?.();
    if (!bbox) continue;

    for (const port of ports) {
      const px = bbox.x + port.position[0] * bbox.width;
      const py = bbox.y + port.position[1] * bbox.height;
      const dist = Math.sqrt((px - pt.x) ** 2 + (py - pt.y) ** 2);
      if (dist < bestDist) {
        bestDist = dist;
        best = { nodeId, port, worldPos: { x: px, y: py } };
      }
    }
  }

  return best;
}

/** Ensure the arrowhead marker exists in <defs>. */
function ensureArrowheadMarker(): void {
  if (arrowheadCreated) return;
  const svg = container.querySelector("svg");
  if (!svg) return;

  // Check if it already exists
  if (svg.querySelector("#arrowhead")) {
    arrowheadCreated = true;
    return;
  }

  const defs = defsId();
  const markerId = createNode(defs, "marker" as any, {
    id: "arrowhead",
    viewBox: "0 0 10 10",
    refX: "10", refY: "5",
    markerWidth: "8", markerHeight: "8",
    orient: "auto-start-reverse",
  });
  createNode(markerId, "path", {
    d: "M 0 0 L 10 5 L 0 10 Z",
    fill: "#64748b",
  });
  arrowheadCreated = true;
}

/** Show a temporary connector line while dragging. */
function showConnectorPreview(from: { x: number; y: number }, to: { x: number; y: number }): void {
  removeConnectorPreview();
  const svg = container.querySelector("svg");
  if (!svg) return;

  const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
  line.setAttribute("x1", String(from.x));
  line.setAttribute("y1", String(from.y));
  line.setAttribute("x2", String(to.x));
  line.setAttribute("y2", String(to.y));
  line.setAttribute("stroke", "#f59e0b");
  line.setAttribute("stroke-width", "2");
  line.setAttribute("stroke-dasharray", "4,4");
  line.setAttribute("data-connector-preview", "true");
  line.style.pointerEvents = "none";
  svg.appendChild(line);
}

/** Remove temporary connector preview. */
function removeConnectorPreview(): void {
  const preview = container.querySelector("[data-connector-preview]");
  if (preview) preview.remove();
}

/** Render port indicators for diagram nodes. Called when connector tool is active or node is selected. */
function renderPortIndicators(): void {
  removePortIndicators();
  if (currentTool !== "connector" && !selectedNodeId) return;

  const svg = container.querySelector("svg");
  if (!svg) return;

  const elements = svg.querySelectorAll("[data-node-id]");
  for (const el of elements) {
    const nodeId = el.getAttribute("data-node-id");
    if (!nodeId) continue;

    let ports: Port[];
    try {
      ports = getPorts(nodeId);
    } catch {
      continue;
    }
    if (ports.length === 0) continue;

    const bbox = (el as SVGGraphicsElement).getBBox?.();
    if (!bbox) continue;

    for (const port of ports) {
      const px = bbox.x + port.position[0] * bbox.width;
      const py = bbox.y + port.position[1] * bbox.height;

      const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      circle.setAttribute("cx", String(px));
      circle.setAttribute("cy", String(py));
      const portRadius = 4 / viewTransform.scale;
      circle.setAttribute("r", String(portRadius));
      circle.setAttribute("fill", "#f59e0b");
      circle.setAttribute("stroke", "#0f172a");
      circle.setAttribute("stroke-width", String(1 / viewTransform.scale));
      circle.setAttribute("data-port-indicator", "true");
      circle.style.pointerEvents = "none";
      svg.appendChild(circle);
    }
  }
}

/** Remove port indicator circles. */
function removePortIndicators(): void {
  const indicators = container.querySelectorAll("[data-port-indicator]");
  indicators.forEach((el) => el.remove());
}

// ── Resize handles ──────────────────────────────────────────────────────────

const HANDLE_SIZE = 8;
const HANDLE_DIRS = ["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const;
let handleElements: SVGRectElement[] = [];

function createResizeHandles() {
  removeResizeHandles();
  if (!selectedNodeId) return;
  const el = getElement(selectedNodeId);
  const svg = container.querySelector("svg");
  if (!el || !svg) return;

  // Skip paths (no simple resize)
  if (el.tagName.toLowerCase() === "path") return;

  const bbox = (el as SVGGraphicsElement).getBBox?.();
  if (!bbox) return;

  for (const dir of HANDLE_DIRS) {
    const handle = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    handle.setAttribute("width", String(HANDLE_SIZE));
    handle.setAttribute("height", String(HANDLE_SIZE));
    handle.setAttribute("fill", "#ffffff");
    handle.setAttribute("stroke", "#3b82f6");
    handle.setAttribute("stroke-width", "1.5");
    handle.setAttribute("data-handle", dir);
    handle.setAttribute("data-selection", "true");
    handle.style.cursor = handleCursor(dir);
    svg.appendChild(handle);
    handleElements.push(handle);
  }

  positionHandles(bbox);
}

function positionHandles(bbox: DOMRect) {
  const hs = HANDLE_SIZE / 2;
  const positions: Record<string, { x: number; y: number }> = {
    nw: { x: bbox.x - hs, y: bbox.y - hs },
    n:  { x: bbox.x + bbox.width / 2 - hs, y: bbox.y - hs },
    ne: { x: bbox.x + bbox.width - hs, y: bbox.y - hs },
    e:  { x: bbox.x + bbox.width - hs, y: bbox.y + bbox.height / 2 - hs },
    se: { x: bbox.x + bbox.width - hs, y: bbox.y + bbox.height - hs },
    s:  { x: bbox.x + bbox.width / 2 - hs, y: bbox.y + bbox.height - hs },
    sw: { x: bbox.x - hs, y: bbox.y + bbox.height - hs },
    w:  { x: bbox.x - hs, y: bbox.y + bbox.height / 2 - hs },
  };

  handleElements.forEach((h) => {
    const dir = h.getAttribute("data-handle")!;
    const pos = positions[dir];
    if (pos) {
      h.setAttribute("x", String(pos.x));
      h.setAttribute("y", String(pos.y));
    }
  });
}

function handleCursor(dir: string): string {
  const cursors: Record<string, string> = {
    nw: "nwse-resize", n: "ns-resize", ne: "nesw-resize", e: "ew-resize",
    se: "nwse-resize", s: "ns-resize", sw: "nesw-resize", w: "ew-resize",
  };
  return cursors[dir] || "pointer";
}

function removeResizeHandles() {
  handleElements.forEach((h) => h.remove());
  handleElements = [];
}

function applyResize(dx: number, dy: number) {
  if (!selectedNodeId || !resizeHandle) return;
  const el = getElement(selectedNodeId);
  if (!el) return;

  const tag = el.tagName.toLowerCase();
  const { x, y, w, h } = computeResizedRect(dx, dy);

  if (tag === "ellipse") {
    el.setAttribute("cx", String(snap(x + w / 2)));
    el.setAttribute("cy", String(snap(y + h / 2)));
    el.setAttribute("rx", String(Math.max(1, snap(w / 2))));
    el.setAttribute("ry", String(Math.max(1, snap(h / 2))));
  } else {
    el.setAttribute("x", String(snap(x)));
    el.setAttribute("y", String(snap(y)));
    el.setAttribute("width", String(Math.max(1, snap(w))));
    el.setAttribute("height", String(Math.max(1, snap(h))));
  }

  updateSelectionOverlay();
}

function commitResize(dx: number, dy: number) {
  if (!selectedNodeId || !resizeHandle) return;
  const el = getElement(selectedNodeId);
  if (!el) return;

  const tag = el.tagName.toLowerCase();
  const { x, y, w, h } = computeResizedRect(dx, dy);

  if (tag === "ellipse") {
    setAttrsBatch(selectedNodeId, {
      cx: String(snap(x + w / 2)),
      cy: String(snap(y + h / 2)),
      rx: String(Math.max(1, snap(w / 2))),
      ry: String(Math.max(1, snap(h / 2))),
    });
  } else {
    setAttrsBatch(selectedNodeId, {
      x: String(snap(x)),
      y: String(snap(y)),
      width: String(Math.max(1, snap(w))),
      height: String(Math.max(1, snap(h))),
    });
  }
  render();
  updateSelectionOverlay();
  if (selectedNodeId) showPropsFor(selectedNodeId);
}

function computeResizedRect(dx: number, dy: number) {
  let { x, y, w, h } = resizeNodeStart;
  const dir = resizeHandle!;

  if (dir.includes("e")) w += dx;
  if (dir.includes("w")) { x += dx; w -= dx; }
  if (dir.includes("s")) h += dy;
  if (dir.includes("n")) { y += dy; h -= dy; }

  // Prevent negative sizes
  if (w < 1) { w = 1; }
  if (h < 1) { h = 1; }

  return { x, y, w, h };
}

// ── Selection ───────────────────────────────────────────────────────────────

let selectionOverlay: SVGRectElement | null = null;

function selectNode(id: string) {
  deselectNode();
  selectedNodeId = id;
  updateSelectionOverlay();
  createResizeHandles();
  renderPortIndicators();
  showPropsFor(id);
  updateBindingForm();
  highlightLayerItem(id);
}

function deselectNode() {
  removeSelectionOverlay();
  removeResizeHandles();
  removePortIndicators();
  selectedNodeId = null;
  showEmptyProps();
  updateBindingForm();
  highlightLayerItem(null);
}

function updateSelectionOverlay() {
  if (!selectedNodeId) return;
  const el = getElement(selectedNodeId);
  const svg = container.querySelector("svg");
  if (!el || !svg) return;
  const bbox = (el as SVGGraphicsElement).getBBox?.();
  if (!bbox) return;

  if (!selectionOverlay) {
    selectionOverlay = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    selectionOverlay.setAttribute("fill", "none");
    selectionOverlay.setAttribute("stroke", "#3b82f6");
    selectionOverlay.setAttribute("stroke-width", "1.5");
    selectionOverlay.setAttribute("stroke-dasharray", "4 3");
    selectionOverlay.setAttribute("pointer-events", "none");
    selectionOverlay.setAttribute("data-selection", "true");
    svg.appendChild(selectionOverlay);
  }
  const pad = 4;
  selectionOverlay.setAttribute("x", String(bbox.x - pad));
  selectionOverlay.setAttribute("y", String(bbox.y - pad));
  selectionOverlay.setAttribute("width", String(bbox.width + pad * 2));
  selectionOverlay.setAttribute("height", String(bbox.height + pad * 2));
  selectionOverlay.setAttribute("rx", "2");

  // Reposition handles
  if (handleElements.length > 0) positionHandles(bbox);
}

function removeSelectionOverlay() {
  selectionOverlay?.remove();
  selectionOverlay = null;
}

// ── Layers Panel ────────────────────────────────────────────────────────────

function updateLayers() {
  const list = document.getElementById("layers-list");
  if (!list) return;

  const svg = container.querySelector("svg");
  if (!svg) { list.innerHTML = '<p style="font-size:11px;color:#475569">No document</p>'; return; }

  const items: string[] = [];
  const defsNodeId = defsId();

  function walk(el: Element, depth: number) {
    const nodeId = el.getAttribute("data-node-id");
    if (!nodeId) return;
    if (el.hasAttribute("data-selection") || el.hasAttribute("data-handle")) return;
    const tag = el.tagName.toLowerCase();
    if (tag === "svg") {
      for (const child of Array.from(el.children)) walk(child, depth);
      return;
    }

    if (nodeId === defsNodeId) return;

    const sel = nodeId === selectedNodeId ? " selected" : "";
    const name = el.getAttribute("id") || el.textContent?.slice(0, 15) || tag;
    const fill = el.getAttribute("fill");
    const swatch = fill && fill !== "none" && fill.startsWith("#")
      ? `<span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${fill}"></span>`
      : "";

    items.push(`
      <div class="layer-item${sel}" style="padding-left:${8 + depth * 16}px" data-layer-id="${nodeId}">
        <span class="tag">${tag}</span>
        ${swatch}
        <span class="name">${name}</span>
      </div>
    `);

    for (const child of Array.from(el.children)) walk(child, depth + 1);
  }

  walk(svg, 0);
  list.innerHTML = items.reverse().join("");

  list.querySelectorAll(".layer-item").forEach((item) => {
    item.addEventListener("click", () => {
      const layerId = (item as HTMLElement).dataset.layerId;
      if (layerId) selectNode(layerId);
    });
  });
}

function highlightLayerItem(id: string | null) {
  document.querySelectorAll(".layer-item").forEach((item) => {
    item.classList.toggle("selected", (item as HTMLElement).dataset.layerId === id);
  });
}

// ── Properties Panel ────────────────────────────────────────────────────────

function showEmptyProps() {
  propContent.innerHTML = '<p style="font-size:12px;color:#475569">Select a shape to edit properties</p>';
}

function showPropsFor(id: string) {
  const el = getElement(id);
  if (!el) return;

  const tag = el.tagName.toLowerCase();
  const fill = el.getAttribute("fill") || "#000000";
  const stroke = el.getAttribute("stroke") || "none";
  const strokeWidth = el.getAttribute("stroke-width") || "1";
  const fillColor = fill.startsWith("#") && fill.length >= 7 ? fill.slice(0, 7) : "#000000";
  const strokeColor = stroke.startsWith("#") && stroke.length >= 7 ? stroke.slice(0, 7) : "#000000";

  let posHtml = "", sizeHtml = "", extraHtml = "";

  if (tag === "circle") {
    posHtml = row("CX", "cx", el) + row("CY", "cy", el);
    sizeHtml = row("R", "r", el);
  } else if (tag === "ellipse") {
    posHtml = row("CX", "cx", el) + row("CY", "cy", el);
    sizeHtml = row("RX", "rx", el) + row("RY", "ry", el);
  } else if (tag === "path") {
    const b = (el as SVGGraphicsElement).getBBox?.();
    posHtml = rowRO("X", b?.x) + rowRO("Y", b?.y);
    sizeHtml = rowRO("W", b?.width) + rowRO("H", b?.height);
  } else if (tag === "text") {
    posHtml = row("X", "x", el) + row("Y", "y", el);
    sizeHtml = row("Size", "font-size", el);
    const textVal = el.textContent || "";
    extraHtml = `<div class="prop-group"><h2>Content</h2>
      <div class="prop-row"><input type="text" data-attr="data-text-content" value="${textVal.replace(/"/g, '&quot;')}" style="flex:1"></div>
    </div>`;
  } else {
    posHtml = row("X", "x", el) + row("Y", "y", el);
    sizeHtml = row("W", "width", el) + row("H", "height", el);
  }

  const opacity = el.getAttribute("opacity") || "1";

  propContent.innerHTML = `
    <div class="prop-group"><h2>${tag.toUpperCase()}</h2></div>
    <div class="prop-group"><h2>Position</h2>${posHtml}</div>
    <div class="prop-group"><h2>Size</h2>${sizeHtml}</div>
    ${extraHtml}
    <div class="prop-group"><h2>Fill & Stroke</h2>
      <div class="prop-row"><label>Fill</label><input type="color" data-attr="fill" value="${fillColor}"><input type="text" data-attr="fill" value="${fill}" style="flex:1"></div>
      <div class="prop-row"><label>Stroke</label><input type="color" data-attr="stroke" value="${strokeColor}"><input type="text" data-attr="stroke" value="${stroke}" style="flex:1"></div>
      <div class="prop-row"><label>Width</label><input type="number" data-attr="stroke-width" value="${strokeWidth}" step="0.5" min="0"></div>
      <div class="prop-row"><label>Opacity</label><input type="number" data-attr="opacity" value="${opacity}" step="0.1" min="0" max="1"></div>
    </div>
    <div class="prop-group" style="font-size:10px;color:#475569;word-break:break-all">ID: ${id.slice(0, 8)}...</div>
  `;

  propContent.querySelectorAll("input:not([disabled])").forEach((input) => {
    const inp = input as HTMLInputElement;
    inp.addEventListener("change", () => {
      const attr = inp.dataset.attr;
      if (attr && selectedNodeId) {
        setAttr(selectedNodeId, attr, inp.value);
        render();
        updateSelectionOverlay();
        updateUndoRedoButtons();
        updateLayers();
        propContent.querySelectorAll(`input[data-attr="${attr}"]`).forEach((s) => {
          if (s !== inp) (s as HTMLInputElement).value = inp.value;
        });
      }
    });
  });
}

function row(label: string, attr: string, el: Element): string {
  return `<div class="prop-row"><label>${label}</label><input type="number" data-attr="${attr}" value="${el.getAttribute(attr) || "0"}"></div>`;
}
function rowRO(label: string, val?: number): string {
  return `<div class="prop-row"><label>${label}</label><input type="number" value="${Math.round(val ?? 0)}" disabled></div>`;
}

// ── Data Binding Panel ──────────────────────────────────────────────────────

function setupDataPanel() {
  const preview = document.getElementById("data-preview")!;

  document.getElementById("btn-load-json")!.addEventListener("click", () => {
    const input = document.createElement("input"); input.type = "file"; input.accept = ".json";
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (file) {
        try { loadedData = JSON.parse(await file.text()); preview.textContent = JSON.stringify(loadedData, null, 2).slice(0, 500); statusText.textContent = `Loaded: ${file.name}`; }
        catch { statusText.textContent = "Invalid JSON"; }
      }
    });
    input.click();
  });

  document.getElementById("btn-load-csv")!.addEventListener("click", () => {
    const input = document.createElement("input"); input.type = "file"; input.accept = ".csv";
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (file) {
        const text = await file.text();
        const lines = text.trim().split("\n");
        const headers = lines[0].split(",").map((h) => h.trim());
        const rows = lines.slice(1).map((line) => {
          const vals = line.split(",").map((v) => v.trim());
          const obj: Record<string, string> = {};
          headers.forEach((h, i) => { obj[h] = vals[i] || ""; });
          return obj;
        });
        loadedData = rows;
        preview.textContent = JSON.stringify(rows, null, 2).slice(0, 500);
        statusText.textContent = `Loaded: ${file.name} (${rows.length} rows)`;
      }
    });
    input.click();
  });

  document.getElementById("btn-sample-data")!.addEventListener("click", () => {
    loadedData = [
      { name: "Alice", score: 95, color: "#3b82f6" },
      { name: "Bob", score: 82, color: "#ef4444" },
      { name: "Carol", score: 91, color: "#22c55e" },
      { name: "Dave", score: 78, color: "#f59e0b" },
    ];
    preview.textContent = JSON.stringify(loadedData, null, 2);
    statusText.textContent = "Loaded sample data (4 rows)";
    updateBindingForm();
  });

  document.getElementById("btn-add-binding")!.addEventListener("click", () => {
    if (!selectedNodeId || !loadedData) return;
    const field = (document.getElementById("bind-field") as HTMLInputElement).value.trim();
    const attr = (document.getElementById("bind-attr") as HTMLSelectElement).value;
    if (!field) return;

    const binding: Binding = {
      source: { Static: { value: Array.isArray(loadedData) ? (loadedData as unknown[])[0] : loadedData } },
      target: selectedNodeId,
      mappings: [{ field, attr, transform: undefined }],
    };
    bind(binding);
    activeBindings.push({ nodeId: selectedNodeId, field, attr });

    const data = Array.isArray(loadedData) ? (loadedData as unknown[])[0] : loadedData;
    evaluateBindings({ _static: data } as Record<string, unknown>);
    fullRerender();
    renderBindingsList();
    statusText.textContent = `Bound ${field} → ${attr}`;
    (document.getElementById("bind-field") as HTMLInputElement).value = "";
  });

  document.getElementById("btn-repeat")!.addEventListener("click", () => {
    if (!selectedNodeId || !loadedData || !Array.isArray(loadedData)) {
      statusText.textContent = "Select a node and load array data first"; return;
    }
    const cols = parseInt((document.getElementById("repeat-cols") as HTMLInputElement).value) || 3;
    const gap = parseInt((document.getElementById("repeat-gap") as HTMLInputElement).value) || 10;
    const ids = repeatTemplate(selectedNodeId, loadedData as Record<string, unknown>[], cols, gap, gap);
    fullRerender();
    statusText.textContent = `Repeated template: ${ids.length} instances`;
  });

  // Generate Diagram from graph JSON
  document.getElementById("btn-generate-diagram")?.addEventListener("click", () => {
    if (!loadedData) { statusText.textContent = "Load graph data first"; return; }
    const data = loadedData as Record<string, unknown>;
    if (!data.nodes || !data.edges) { statusText.textContent = "Data must have 'nodes' and 'edges' arrays"; return; }

    const result = generateDiagram(
      data as { nodes: Array<{ id: string; label: string; type?: string }>; edges: Array<{ from: string; to: string }> },
      { direction: "TopToBottom", nodeGap: 40, layerGap: 80 },
    );
    fullRerender();
    statusText.textContent = `Generated diagram: ${Object.keys(result.nodeMap).length} nodes, ${result.connectorCount} connectors`;
  });

  // Sample graph data
  document.getElementById("btn-sample-graph")?.addEventListener("click", () => {
    loadedData = {
      nodes: [
        { id: "client", label: "Browser Client", type: "client" },
        { id: "api", label: "API Gateway", type: "service" },
        { id: "auth", label: "Auth Service", type: "service" },
        { id: "cache", label: "Redis Cache", type: "cache" },
        { id: "db", label: "PostgreSQL", type: "database" },
        { id: "queue", label: "Message Queue", type: "queue" },
        { id: "worker", label: "Background Worker", type: "service" },
      ],
      edges: [
        { from: "client", to: "api" },
        { from: "api", to: "auth" },
        { from: "api", to: "cache" },
        { from: "api", to: "db" },
        { from: "api", to: "queue" },
        { from: "queue", to: "worker" },
        { from: "worker", to: "db" },
      ],
    };
    preview.textContent = JSON.stringify(loadedData, null, 2).slice(0, 600);
    statusText.textContent = "Loaded sample graph (7 nodes, 7 edges)";
    updateBindingForm();
    // Show the generate button
    const genBtn = document.getElementById("btn-generate-diagram");
    if (genBtn) genBtn.style.display = "";
  });
}

function updateBindingForm() {
  const form = document.getElementById("binding-form")!;
  form.style.display = (selectedNodeId && loadedData) ? "block" : "none";
  renderBindingsList();
}

function renderBindingsList() {
  const list = document.getElementById("bindings-list")!;
  const nb = selectedNodeId ? activeBindings.filter((b) => b.nodeId === selectedNodeId) : [];
  if (nb.length === 0) { list.innerHTML = '<p style="font-size:11px;color:#475569">No bindings on this node</p>'; return; }
  list.innerHTML = nb.map((b) => `<div class="binding-item"><span class="field">${b.field}</span><span class="arrow">&rarr;</span><span class="attr">${b.attr}</span></div>`).join("");
}

// ── Node Palette ─────────────────────────────────────────────────────────────

async function setupNodePalette() {
  const paletteEl = document.getElementById("node-palette");
  if (!paletteEl) return;
  await initPalette(paletteEl, {
    onPlaceNode: (_typeId, _x, _y) => {
      // Handled in onPointerDown via getPlacingType()
    },
    onModeChange: (mode) => {
      container.style.cursor = mode === "placing" ? "crosshair" : "";
      if (mode === "placing") {
        currentTool = "select";
        document.querySelectorAll(".toolbar button").forEach(b => b.classList.remove("active"));
        document.getElementById("tool-select")?.classList.add("active");
      }
    },
  });
}

// ── Start ───────────────────────────────────────────────────────────────────

init();
