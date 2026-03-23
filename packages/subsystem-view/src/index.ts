import type { Subsystem, NodeDef, ExecContext, NodeId } from "@svg-os/core";

// ── SVG Template Node ─────────────────────────────────────────────────────────

const svgTemplateNodeDef: NodeDef = {
  type: "view:svg-template",
  subsystem: "view",
  inputs: [{ name: "data", type: "data" }],
  outputs: [{ name: "renderData", type: "data" }],
  execute(ctx: ExecContext, nodeId: NodeId) {
    const config = ctx.getConfig(nodeId);
    const inputData = ctx.getInput(nodeId, "data") as Record<string, unknown>;

    // Merge config data with input data
    let ownData: Record<string, unknown> = {};
    try {
      const d = config.data as string;
      if (d) ownData = JSON.parse(d);
    } catch { /* */ }

    const mergedData = { ...ownData, ...inputData };

    // Template rendering is delegated to the Rust WASM bridge
    // The canvas layer calls renderTemplateInline() with this data
    // Here we just store the merged data for the canvas to pick up
    ctx.setOutput(nodeId, "renderData", mergedData);
  },
};

// ── Note Node ─────────────────────────────────────────────────────────────────

const noteNodeDef: NodeDef = {
  type: "view:note",
  subsystem: "view",
  inputs: [{ name: "data", type: "data", optional: true }],
  outputs: [{ name: "text", type: "text" }],
  execute(ctx: ExecContext, nodeId: NodeId) {
    const config = ctx.getConfig(nodeId);
    let content = (config.content as string) || "";
    const input = ctx.getInput(nodeId, "data") as Record<string, unknown>;

    // Interpolate {{field}} placeholders from upstream
    if (input && Object.keys(input).length > 0) {
      content = content.replace(/\{\{(\w+)\}\}/g, (_m: string, field: string) => {
        return input[field] != null ? String(input[field]) : "";
      });
    }

    ctx.setOutput(nodeId, "text", content);
  },
};

// ── WebView Node ──────────────────────────────────────────────────────────────

const webviewNodeDef: NodeDef = {
  type: "view:webview",
  subsystem: "view",
  inputs: [{ name: "url", type: "text", optional: true }],
  outputs: [{ name: "url", type: "text" }],
  execute(ctx: ExecContext, nodeId: NodeId) {
    const config = ctx.getConfig(nodeId);
    const inputUrl = ctx.getInput(nodeId, "url") as string;
    const url = inputUrl || (config.url as string) || "";

    // Store resolved URL for canvas to render
    ctx.setOutput(nodeId, "url", url);
  },
};

// ── Metric Node ───────────────────────────────────────────────────────────────

const metricNodeDef: NodeDef = {
  type: "view:metric",
  subsystem: "view",
  inputs: [
    { name: "value", type: "number" },
    { name: "label", type: "text", optional: true },
  ],
  outputs: [{ name: "display", type: "data" }],
  execute(ctx: ExecContext, nodeId: NodeId) {
    const config = ctx.getConfig(nodeId);
    const value = ctx.getInput(nodeId, "value") ?? config.value ?? 0;
    const label = (ctx.getInput(nodeId, "label") as string) ?? (config.label as string) ?? "Value";

    ctx.setOutput(nodeId, "display", { value, label });
  },
};

// ── Chart Node (stub) ─────────────────────────────────────────────────────────

const chartNodeDef: NodeDef = {
  type: "view:chart",
  subsystem: "view",
  inputs: [{ name: "data", type: "array" }],
  outputs: [
    { name: "image", type: "image", optional: true },
    { name: "chartData", type: "array", optional: true },
  ],
  execute(ctx: ExecContext, nodeId: NodeId) {
    const data = ctx.getInput(nodeId, "data");
    // Chart rendering delegated to canvas layer (D3 or similar)
    ctx.setOutput(nodeId, "chartData", data);
  },
};

// ── View Subsystem ────────────────────────────────────────────────────────────

export const viewSubsystem: Subsystem = {
  id: "view",
  name: "View",
  nodeTypes: [
    svgTemplateNodeDef,
    noteNodeDef,
    webviewNodeDef,
    metricNodeDef,
    chartNodeDef,
  ],
  init(_runtime) {
    // View subsystem is ready immediately
    // WASM bridge initialization happens in the canvas layer
  },
};
