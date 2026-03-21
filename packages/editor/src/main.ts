/**
 * SVG OS Editor — MVP canvas with zoom/pan, layers, text tool, data binding.
 */

import {
  loadWasm,
  rootId, defsId, createNode, removeNode, setAttr, setAttrsBatch,
  undo, redo, canUndo, canRedo,
  getRenderOps, getFullRenderOps, applyOps, resetElementMap,
  importSvg, exportSvg, getElement,
  bind, evaluateBindings, applyTheme, repeatTemplate,
} from "@svg-os/bridge";
import type { Binding, Theme } from "@svg-os/bridge";

// ── State ───────────────────────────────────────────────────────────────────

type Tool = "select" | "rect" | "ellipse" | "path" | "text";

let currentTool: Tool = "select";
let selectedNodeId: string | null = null;
let isDragging = false;
let isPanning = false;
let dragStart = { x: 0, y: 0 };
let dragNodeStart = { x: 0, y: 0 };
let panStart = { x: 0, y: 0 };
let viewTransform = { x: 0, y: 0, scale: 1 };
let loadedData: unknown = null;
let activeBindings: Array<{ nodeId: string; field: string; attr: string }> = [];

const container = document.getElementById("canvas-container")!;
const statusText = document.getElementById("status-text")!;
const statusNodes = document.getElementById("status-nodes")!;
const statusZoom = document.getElementById("status-zoom")!;
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
    setupPanelTabs();
    setupDataPanel();
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
  svg.style.transform = `translate(${viewTransform.x}px, ${viewTransform.y}px) scale(${viewTransform.scale})`;
  svg.style.transformOrigin = "0 0";
}

function updateStatus() {
  const svg = container.querySelector("svg");
  if (svg) {
    const count = svg.querySelectorAll("*:not([data-selection])").length;
    statusNodes.textContent = `${count} elements`;
  }
  statusZoom.textContent = `${Math.round(viewTransform.scale * 100)}%`;
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
  const tools: Tool[] = ["select", "rect", "ellipse", "path", "text"];
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
}

// ── Keyboard ────────────────────────────────────────────────────────────────

function setupKeyboard() {
  document.addEventListener("keydown", (e) => {
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

    if (!e.ctrlKey && !e.metaKey) {
      switch (e.key.toLowerCase()) {
        case "v": setTool("select"); return;
        case "r": setTool("rect"); return;
        case "e": setTool("ellipse"); return;
        case "p": setTool("path"); return;
        case "t": setTool("text"); return;
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
    if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) { e.preventDefault(); undo(); fullRerender(); }
    if ((e.ctrlKey || e.metaKey) && (e.key === "Z" || (e.key === "z" && e.shiftKey))) { e.preventDefault(); redo(); fullRerender(); }
    if ((e.ctrlKey || e.metaKey) && e.key === "y") { e.preventDefault(); redo(); fullRerender(); }
    // Ctrl+= / Ctrl+- zoom
    if ((e.ctrlKey || e.metaKey) && (e.key === "=" || e.key === "+")) { e.preventDefault(); zoom(1.2); }
    if ((e.ctrlKey || e.metaKey) && e.key === "-") { e.preventDefault(); zoom(1 / 1.2); }
  });
}

function setTool(tool: Tool) {
  currentTool = tool;
  document.querySelectorAll(".toolbar button[id^='tool-']").forEach((b) => b.classList.remove("active"));
  document.getElementById(`tool-${tool}`)?.classList.add("active");
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
    // Pinch zoom
    const factor = e.deltaY > 0 ? 1 / 1.1 : 1.1;
    const rect = container.getBoundingClientRect();
    zoom(factor, e.clientX - rect.left, e.clientY - rect.top);
  } else {
    // Scroll to pan
    viewTransform.x -= e.deltaX;
    viewTransform.y -= e.deltaY;
    applyViewTransform();
    updateStatus();
  }
}

function onPointerDown(e: PointerEvent) {
  const pt = getSvgPoint(e.clientX, e.clientY);

  // Middle mouse or space+click to pan
  if (e.button === 1) {
    isPanning = true;
    panStart = { x: e.clientX - viewTransform.x, y: e.clientY - viewTransform.y };
    container.setPointerCapture(e.pointerId);
    container.style.cursor = "grabbing";
    return;
  }

  if (currentTool === "select") {
    const target = e.target as Element;
    const nodeId = target?.getAttribute?.("data-node-id");
    if (nodeId && target.tagName !== "svg" && target.tagName !== "defs" && !target.hasAttribute("data-selection")) {
      selectNode(nodeId);
      isDragging = true;
      dragStart = pt;
      const keys = posKeys(target);
      dragNodeStart = { x: parseFloat(target.getAttribute(keys.x) || "0"), y: parseFloat(target.getAttribute(keys.y) || "0") };
      container.setPointerCapture(e.pointerId);
    } else {
      deselectNode();
    }
  } else if (currentTool === "text") {
    const root = rootId();
    const id = createNode(root, "text", {
      x: String(Math.round(pt.x)),
      y: String(Math.round(pt.y)),
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
  } else {
    const root = rootId();
    const s = 80;
    let id: string | undefined;

    if (currentTool === "rect") {
      id = createNode(root, "rect", {
        x: String(Math.round(pt.x - s/2)), y: String(Math.round(pt.y - s/2)),
        width: String(s), height: String(s), fill: "#3b82f6", stroke: "#1d4ed8", "stroke-width": "2", rx: "4",
      });
    } else if (currentTool === "ellipse") {
      id = createNode(root, "ellipse", {
        cx: String(Math.round(pt.x)), cy: String(Math.round(pt.y)),
        rx: String(s/2), ry: String(s/3), fill: "#8b5cf6", stroke: "#6d28d9", "stroke-width": "2",
      });
    } else if (currentTool === "path") {
      id = createNode(root, "path", {
        d: `M${Math.round(pt.x)},${Math.round(pt.y)} l60,-30 l0,60 Z`,
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
  if (!isDragging || !selectedNodeId) return;
  const pt = getSvgPoint(e.clientX, e.clientY);
  const el = getElement(selectedNodeId);
  if (!el) return;
  const keys = posKeys(el);
  el.setAttribute(keys.x, String(Math.round(dragNodeStart.x + pt.x - dragStart.x)));
  el.setAttribute(keys.y, String(Math.round(dragNodeStart.y + pt.y - dragStart.y)));
  updateSelectionOverlay();
}

function onPointerUp(e: PointerEvent) {
  if (isPanning) {
    isPanning = false;
    container.releasePointerCapture(e.pointerId);
    container.style.cursor = "";
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
  updateBindingForm();
  highlightLayerItem(id);
}

function deselectNode() {
  removeSelectionOverlay();
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
    if (el.hasAttribute("data-selection")) return;
    const tag = el.tagName.toLowerCase();
    if (tag === "svg") {
      // Walk children only
      for (const child of Array.from(el.children)) walk(child, depth);
      return;
    }

    // Skip defs subtree in layer list
    if (nodeId === defsNodeId) return;

    const indent = depth > 0 ? ` class="layer-indent"`.repeat(Math.min(depth, 3)) : "";
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
  list.innerHTML = items.reverse().join(""); // Top layer first

  // Click to select
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
    evaluateBindings(JSON.stringify({ _static: data }));
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

// ── Start ───────────────────────────────────────────────────────────────────

init();
