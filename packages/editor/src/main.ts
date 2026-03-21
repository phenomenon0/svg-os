/**
 * SVG OS Editor — Minimal MVP canvas.
 *
 * Proof-of-life editor that wires up all WASM layers:
 * - Create shapes via toolbar tools
 * - Select + drag to move
 * - Property panel for fill/stroke/dimensions
 * - Undo/redo
 * - Export/import SVG
 */

import {
  loadWasm,
  rootId, createNode, removeNode, setAttr,
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
  // Clear DOM and re-render from scratch using full render (not diff)
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
    // Tool shortcuts
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
            showEmptyProps();
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
    if ((e.ctrlKey || e.metaKey) && e.key === "z" && e.shiftKey) {
      e.preventDefault();
      redo();
      fullRerender();
    }
  });
}

function setTool(tool: Tool) {
  currentTool = tool;
  document.querySelectorAll(".toolbar button").forEach((b) => b.classList.remove("active"));
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
  const scaleX = viewBox.width / rect.width;
  const scaleY = viewBox.height / rect.height;
  return {
    x: (e.clientX - rect.left) * scaleX + viewBox.x,
    y: (e.clientY - rect.top) * scaleY + viewBox.y,
  };
}

function onPointerDown(e: PointerEvent) {
  const pt = getSvgPoint(e);

  if (currentTool === "select") {
    // Hit test: find element under cursor
    const target = e.target as Element;
    const nodeId = target?.getAttribute?.("data-node-id");
    if (nodeId && target.tagName !== "svg") {
      selectNode(nodeId);
      isDragging = true;
      dragStart = { x: pt.x, y: pt.y };
      // Read current position from attrs
      const xAttr = target.getAttribute("x") || target.getAttribute("cx") || "0";
      const yAttr = target.getAttribute("y") || target.getAttribute("cy") || "0";
      dragNodeStart = { x: parseFloat(xAttr), y: parseFloat(yAttr) };
      container.setPointerCapture(e.pointerId);
    } else {
      deselectNode();
    }
  } else {
    // Creation tools
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

    // Switch back to select after creating
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

  const isCircle = el.tagName === "circle" || el.tagName === "ellipse";
  const xKey = isCircle ? "cx" : "x";
  const yKey = isCircle ? "cy" : "y";

  const newX = String(Math.round(dragNodeStart.x + dx));
  const newY = String(Math.round(dragNodeStart.y + dy));

  // Live preview via direct DOM manipulation (final position committed on pointerup)
  el.setAttribute(xKey, newX);
  el.setAttribute(yKey, newY);
}

function onPointerUp(e: PointerEvent) {
  if (!isDragging || !selectedNodeId) return;

  const pt = getSvgPoint(e);
  const dx = pt.x - dragStart.x;
  const dy = pt.y - dragStart.y;

  if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
    // Commit the move via WASM (for undo/redo)
    const el = getElement(selectedNodeId);
    const isCircle = el?.tagName === "circle" || el?.tagName === "ellipse";
    const xKey = isCircle ? "cx" : "x";
    const yKey = isCircle ? "cy" : "y";

    setAttr(selectedNodeId, xKey, String(Math.round(dragNodeStart.x + dx)));
    setAttr(selectedNodeId, yKey, String(Math.round(dragNodeStart.y + dy)));
    render();
  }

  isDragging = false;
  container.releasePointerCapture(e.pointerId);
  updateUndoRedoButtons();
  if (selectedNodeId) showPropsFor(selectedNodeId);
}

// ── Selection ───────────────────────────────────────────────────────────────

function selectNode(id: string) {
  deselectNode();
  selectedNodeId = id;
  const el = getElement(id);
  if (el) {
    (el as SVGElement).style.outline = "2px solid #3b82f6";
    (el as SVGElement).style.outlineOffset = "2px";
  }
  showPropsFor(id);
}

function deselectNode() {
  if (selectedNodeId) {
    const el = getElement(selectedNodeId);
    if (el) {
      (el as SVGElement).style.outline = "";
      (el as SVGElement).style.outlineOffset = "";
    }
  }
  selectedNodeId = null;
  showEmptyProps();
}

// ── Properties Panel ────────────────────────────────────────────────────────

function showEmptyProps() {
  propContent.innerHTML = '<p style="font-size:12px;color:#475569">Select a shape to edit properties</p>';
}

function showPropsFor(id: string) {
  const el = getElement(id);
  if (!el) return;

  const tag = el.tagName.toLowerCase();
  const isCircle = tag === "circle" || tag === "ellipse";

  const xKey = isCircle ? "cx" : "x";
  const yKey = isCircle ? "cy" : "y";
  const wKey = isCircle ? "rx" : "width";
  const hKey = isCircle ? "ry" : "height";

  const x = el.getAttribute(xKey) || "0";
  const y = el.getAttribute(yKey) || "0";
  const w = el.getAttribute(wKey) || "0";
  const h = el.getAttribute(hKey) || "0";
  const fill = el.getAttribute("fill") || "#000000";
  const stroke = el.getAttribute("stroke") || "none";
  const strokeWidth = el.getAttribute("stroke-width") || "1";

  propContent.innerHTML = `
    <div class="prop-group">
      <h2>Position</h2>
      <div class="prop-row"><label>${xKey.toUpperCase()}</label><input type="number" data-attr="${xKey}" value="${x}"></div>
      <div class="prop-row"><label>${yKey.toUpperCase()}</label><input type="number" data-attr="${yKey}" value="${y}"></div>
    </div>
    <div class="prop-group">
      <h2>Size</h2>
      <div class="prop-row"><label>${wKey === "rx" ? "RX" : "W"}</label><input type="number" data-attr="${wKey}" value="${w}"></div>
      <div class="prop-row"><label>${hKey === "ry" ? "RY" : "H"}</label><input type="number" data-attr="${hKey}" value="${h}"></div>
    </div>
    <div class="prop-group">
      <h2>Fill & Stroke</h2>
      <div class="prop-row"><label>Fill</label><input type="color" data-attr="fill" value="${fill}"><input type="text" data-attr="fill" value="${fill}" style="flex:1"></div>
      <div class="prop-row"><label>Stroke</label><input type="color" data-attr="stroke" value="${stroke === 'none' ? '#000000' : stroke}"><input type="text" data-attr="stroke" value="${stroke}" style="flex:1"></div>
      <div class="prop-row"><label>Width</label><input type="number" data-attr="stroke-width" value="${strokeWidth}" step="0.5"></div>
    </div>
  `;

  // Wire up change events
  propContent.querySelectorAll("input").forEach((input) => {
    input.addEventListener("change", () => {
      const attr = input.dataset.attr;
      if (attr && selectedNodeId) {
        setAttr(selectedNodeId, attr, input.value);
        render();
        updateUndoRedoButtons();
        // Sync sibling inputs (color picker + text field)
        propContent.querySelectorAll(`input[data-attr="${attr}"]`).forEach((sibling) => {
          if (sibling !== input) (sibling as HTMLInputElement).value = input.value;
        });
      }
    });
  });
}

// ── Start ───────────────────────────────────────────────────────────────────

init();
