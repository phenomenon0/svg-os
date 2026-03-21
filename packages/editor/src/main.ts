/**
 * SVG OS Editor — Minimal MVP canvas.
 *
 * Proof-of-life editor that wires up all WASM layers:
 * - Create shapes via toolbar tools
 * - Select + drag to move (batched undo)
 * - Property panel for fill/stroke/dimensions (shape-aware)
 * - Undo/redo
 * - Export/import SVG
 */

import {
  loadWasm,
  rootId, createNode, removeNode, setAttr, setAttrsBatch,
  undo, redo, canUndo, canRedo,
  getRenderOps, getFullRenderOps, applyOps, resetElementMap,
  importSvg, exportSvg, getElement,
} from "@svg-os/bridge";

// ── State ───────────────────────────────────────────────────────────────────

type Tool = "select" | "rect" | "ellipse" | "path";

let currentTool: Tool = "select";
let selectedNodeId: string | null = null;
let isDragging = false;
let dragStart = { x: 0, y: 0 };
let dragNodeStart = { x: 0, y: 0 };

const container = document.getElementById("canvas-container")!;
const statusText = document.getElementById("status-text")!;
const statusNodes = document.getElementById("status-nodes")!;
const propContent = document.getElementById("prop-content")!;

// ── Init ────────────────────────────────────────────────────────────────────

async function init() {
  try {
    await loadWasm();
    statusText.textContent = "Ready";
    render();
    setupTools();
    setupKeyboard();
    setupCanvasEvents();
    updateUndoRedoButtons();
  } catch (e) {
    statusText.textContent = `Failed to load WASM: ${e}`;
    console.error(e);
  }
}

// ── Rendering ───────────────────────────────────────────────────────────────

function render() {
  const ops = getRenderOps();
  applyOps(container, ops);
  updateStatus();
}

function fullRerender() {
  container.innerHTML = "";
  resetElementMap();
  const ops = getFullRenderOps();
  applyOps(container, ops);
  deselectNode();
  updateStatus();
}

function updateStatus() {
  const svg = container.querySelector("svg");
  if (svg) {
    statusNodes.textContent = `${svg.querySelectorAll("*").length} elements`;
  }
  updateUndoRedoButtons();
}

function updateUndoRedoButtons() {
  (document.getElementById("btn-undo") as HTMLButtonElement).disabled = !canUndo();
  (document.getElementById("btn-redo") as HTMLButtonElement).disabled = !canRedo();
}

// ── Tools ───────────────────────────────────────────────────────────────────

function setupTools() {
  const toolButtons: Record<Tool, HTMLElement> = {
    select: document.getElementById("tool-select")!,
    rect: document.getElementById("tool-rect")!,
    ellipse: document.getElementById("tool-ellipse")!,
    path: document.getElementById("tool-path")!,
  };

  for (const [tool, btn] of Object.entries(toolButtons)) {
    btn.addEventListener("click", () => {
      currentTool = tool as Tool;
      for (const b of Object.values(toolButtons)) b.classList.remove("active");
      btn.classList.add("active");
    });
  }

  document.getElementById("btn-undo")!.addEventListener("click", () => {
    undo();
    fullRerender();
  });

  document.getElementById("btn-redo")!.addEventListener("click", () => {
    redo();
    fullRerender();
  });

  document.getElementById("btn-export")!.addEventListener("click", () => {
    const svg = exportSvg();
    const blob = new Blob([svg], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "svg-os-export.svg";
    a.click();
    URL.revokeObjectURL(url);
  });

  document.getElementById("btn-import")!.addEventListener("click", () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".svg";
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (file) {
        const text = await file.text();
        importSvg(text);
        fullRerender();
      }
    });
    input.click();
  });
}

// ── Keyboard ────────────────────────────────────────────────────────────────

function setupKeyboard() {
  document.addEventListener("keydown", (e) => {
    // Don't intercept when typing in inputs
    if ((e.target as HTMLElement)?.tagName === "INPUT") return;

    if (!e.ctrlKey && !e.metaKey) {
      switch (e.key.toLowerCase()) {
        case "v": setTool("select"); return;
        case "r": setTool("rect"); return;
        case "e": setTool("ellipse"); return;
        case "p": setTool("path"); return;
        case "delete":
        case "backspace":
          if (selectedNodeId) {
            removeNode(selectedNodeId);
            selectedNodeId = null;
            fullRerender();
          }
          return;
      }
    }

    // Undo/Redo
    if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) {
      e.preventDefault();
      undo();
      fullRerender();
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === "Z" || (e.key === "z" && e.shiftKey))) {
      e.preventDefault();
      redo();
      fullRerender();
    }
    // Also support Ctrl+Y for redo
    if ((e.ctrlKey || e.metaKey) && e.key === "y") {
      e.preventDefault();
      redo();
      fullRerender();
    }
  });
}

function setTool(tool: Tool) {
  currentTool = tool;
  document.querySelectorAll(".toolbar button[id^='tool-']").forEach((b) => b.classList.remove("active"));
  document.getElementById(`tool-${tool}`)?.classList.add("active");
}

// ── Canvas Events ───────────────────────────────────────────────────────────

function setupCanvasEvents() {
  container.addEventListener("pointerdown", onPointerDown);
  container.addEventListener("pointermove", onPointerMove);
  container.addEventListener("pointerup", onPointerUp);
}

function getSvgPoint(e: PointerEvent): { x: number; y: number } {
  const svg = container.querySelector("svg");
  if (!svg) return { x: e.offsetX, y: e.offsetY };
  const rect = svg.getBoundingClientRect();
  const viewBox = svg.viewBox.baseVal;
  if (!viewBox || viewBox.width === 0) return { x: e.offsetX, y: e.offsetY };
  const scaleX = viewBox.width / rect.width;
  const scaleY = viewBox.height / rect.height;
  return {
    x: (e.clientX - rect.left) * scaleX + viewBox.x,
    y: (e.clientY - rect.top) * scaleY + viewBox.y,
  };
}

/** Get the position attribute keys for a given element type. */
function posKeys(el: Element): { x: string; y: string } {
  const tag = el.tagName.toLowerCase();
  if (tag === "circle" || tag === "ellipse") return { x: "cx", y: "cy" };
  return { x: "x", y: "y" };
}

function onPointerDown(e: PointerEvent) {
  const pt = getSvgPoint(e);

  if (currentTool === "select") {
    const target = e.target as Element;
    const nodeId = target?.getAttribute?.("data-node-id");

    // Don't select the root <svg> or <defs>
    if (nodeId && target.tagName !== "svg" && target.tagName !== "defs") {
      selectNode(nodeId);
      isDragging = true;
      dragStart = { x: pt.x, y: pt.y };

      const keys = posKeys(target);
      const xAttr = target.getAttribute(keys.x) || "0";
      const yAttr = target.getAttribute(keys.y) || "0";
      dragNodeStart = { x: parseFloat(xAttr), y: parseFloat(yAttr) };
      container.setPointerCapture(e.pointerId);
    } else {
      deselectNode();
    }
  } else {
    // Shape creation tools
    const root = rootId();
    const size = 80;

    if (currentTool === "rect") {
      const id = createNode(root, "rect", {
        x: String(Math.round(pt.x - size / 2)),
        y: String(Math.round(pt.y - size / 2)),
        width: String(size),
        height: String(size),
        fill: "#3b82f6",
        stroke: "#1d4ed8",
        "stroke-width": "2",
        rx: "4",
      });
      render();
      selectNode(id);
    } else if (currentTool === "ellipse") {
      const id = createNode(root, "ellipse", {
        cx: String(Math.round(pt.x)),
        cy: String(Math.round(pt.y)),
        rx: String(size / 2),
        ry: String(size / 3),
        fill: "#8b5cf6",
        stroke: "#6d28d9",
        "stroke-width": "2",
      });
      render();
      selectNode(id);
    } else if (currentTool === "path") {
      const d = `M${Math.round(pt.x)},${Math.round(pt.y)} l60,-30 l0,60 Z`;
      const id = createNode(root, "path", {
        d,
        fill: "#f59e0b",
        stroke: "#d97706",
        "stroke-width": "2",
      });
      render();
      selectNode(id);
    }

    setTool("select");
  }
}

function onPointerMove(e: PointerEvent) {
  if (!isDragging || !selectedNodeId) return;
  const pt = getSvgPoint(e);
  const dx = pt.x - dragStart.x;
  const dy = pt.y - dragStart.y;

  const el = getElement(selectedNodeId);
  if (!el) return;

  const keys = posKeys(el);
  const newX = String(Math.round(dragNodeStart.x + dx));
  const newY = String(Math.round(dragNodeStart.y + dy));

  // Live preview via direct DOM (committed on pointerup)
  el.setAttribute(keys.x, newX);
  el.setAttribute(keys.y, newY);

  // Update selection overlay position
  updateSelectionOverlay();
}

function onPointerUp(e: PointerEvent) {
  if (!isDragging || !selectedNodeId) return;

  const pt = getSvgPoint(e);
  const dx = pt.x - dragStart.x;
  const dy = pt.y - dragStart.y;

  if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
    // Commit move as a single undoable batch
    const el = getElement(selectedNodeId);
    if (el) {
      const keys = posKeys(el);
      setAttrsBatch(selectedNodeId, {
        [keys.x]: String(Math.round(dragNodeStart.x + dx)),
        [keys.y]: String(Math.round(dragNodeStart.y + dy)),
      });
      render();
    }
  }

  isDragging = false;
  container.releasePointerCapture(e.pointerId);
  updateUndoRedoButtons();
  if (selectedNodeId) showPropsFor(selectedNodeId);
}

// ── Selection ───────────────────────────────────────────────────────────────

let selectionOverlay: SVGRectElement | null = null;

function selectNode(id: string) {
  deselectNode();
  selectedNodeId = id;
  updateSelectionOverlay();
  showPropsFor(id);
}

function deselectNode() {
  removeSelectionOverlay();
  selectedNodeId = null;
  showEmptyProps();
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
}

function removeSelectionOverlay() {
  if (selectionOverlay) {
    selectionOverlay.remove();
    selectionOverlay = null;
  }
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

  // Fill color value safe for color input (must be #rrggbb)
  const fillColor = fill.startsWith("#") && fill.length >= 7 ? fill.slice(0, 7) : "#000000";
  const strokeColor = stroke.startsWith("#") && stroke.length >= 7 ? stroke.slice(0, 7) : "#000000";

  let positionHtml = "";
  let sizeHtml = "";

  if (tag === "circle") {
    const cx = el.getAttribute("cx") || "0";
    const cy = el.getAttribute("cy") || "0";
    const r = el.getAttribute("r") || "0";
    positionHtml = `
      <div class="prop-row"><label>CX</label><input type="number" data-attr="cx" value="${cx}"></div>
      <div class="prop-row"><label>CY</label><input type="number" data-attr="cy" value="${cy}"></div>`;
    sizeHtml = `
      <div class="prop-row"><label>R</label><input type="number" data-attr="r" value="${r}"></div>`;
  } else if (tag === "ellipse") {
    const cx = el.getAttribute("cx") || "0";
    const cy = el.getAttribute("cy") || "0";
    const rx = el.getAttribute("rx") || "0";
    const ry = el.getAttribute("ry") || "0";
    positionHtml = `
      <div class="prop-row"><label>CX</label><input type="number" data-attr="cx" value="${cx}"></div>
      <div class="prop-row"><label>CY</label><input type="number" data-attr="cy" value="${cy}"></div>`;
    sizeHtml = `
      <div class="prop-row"><label>RX</label><input type="number" data-attr="rx" value="${rx}"></div>
      <div class="prop-row"><label>RY</label><input type="number" data-attr="ry" value="${ry}"></div>`;
  } else if (tag === "path") {
    // Paths don't have x/y — show the bounding box info read-only
    const bbox = (el as SVGGraphicsElement).getBBox?.();
    if (bbox) {
      positionHtml = `
        <div class="prop-row"><label>X</label><input type="number" value="${Math.round(bbox.x)}" disabled></div>
        <div class="prop-row"><label>Y</label><input type="number" value="${Math.round(bbox.y)}" disabled></div>`;
      sizeHtml = `
        <div class="prop-row"><label>W</label><input type="number" value="${Math.round(bbox.width)}" disabled></div>
        <div class="prop-row"><label>H</label><input type="number" value="${Math.round(bbox.height)}" disabled></div>`;
    }
  } else if (tag === "text") {
    const x = el.getAttribute("x") || "0";
    const y = el.getAttribute("y") || "0";
    const fontSize = el.getAttribute("font-size") || "16";
    positionHtml = `
      <div class="prop-row"><label>X</label><input type="number" data-attr="x" value="${x}"></div>
      <div class="prop-row"><label>Y</label><input type="number" data-attr="y" value="${y}"></div>`;
    sizeHtml = `
      <div class="prop-row"><label>Size</label><input type="number" data-attr="font-size" value="${fontSize}"></div>`;
  } else {
    // rect, line, etc.
    const x = el.getAttribute("x") || "0";
    const y = el.getAttribute("y") || "0";
    const w = el.getAttribute("width") || "0";
    const h = el.getAttribute("height") || "0";
    positionHtml = `
      <div class="prop-row"><label>X</label><input type="number" data-attr="x" value="${x}"></div>
      <div class="prop-row"><label>Y</label><input type="number" data-attr="y" value="${y}"></div>`;
    sizeHtml = `
      <div class="prop-row"><label>W</label><input type="number" data-attr="width" value="${w}"></div>
      <div class="prop-row"><label>H</label><input type="number" data-attr="height" value="${h}"></div>`;
  }

  propContent.innerHTML = `
    <div class="prop-group">
      <h2>${tag.toUpperCase()}</h2>
    </div>
    <div class="prop-group">
      <h2>Position</h2>
      ${positionHtml}
    </div>
    <div class="prop-group">
      <h2>Size</h2>
      ${sizeHtml}
    </div>
    <div class="prop-group">
      <h2>Fill & Stroke</h2>
      <div class="prop-row"><label>Fill</label><input type="color" data-attr="fill" value="${fillColor}"><input type="text" data-attr="fill" value="${fill}" style="flex:1"></div>
      <div class="prop-row"><label>Stroke</label><input type="color" data-attr="stroke" value="${strokeColor}"><input type="text" data-attr="stroke" value="${stroke}" style="flex:1"></div>
      <div class="prop-row"><label>Width</label><input type="number" data-attr="stroke-width" value="${strokeWidth}" step="0.5" min="0"></div>
    </div>
  `;

  // Wire up change events
  propContent.querySelectorAll("input:not([disabled])").forEach((input) => {
    const inp = input as HTMLInputElement;
    inp.addEventListener("change", () => {
      const attr = inp.dataset.attr;
      if (attr && selectedNodeId) {
        setAttr(selectedNodeId, attr, inp.value);
        render();
        updateSelectionOverlay();
        updateUndoRedoButtons();
        // Sync paired color picker + text field
        propContent.querySelectorAll(`input[data-attr="${attr}"]`).forEach((sibling) => {
          if (sibling !== inp) (sibling as HTMLInputElement).value = inp.value;
        });
      }
    });
  });
}

// ── Start ───────────────────────────────────────────────────────────────────

init();
