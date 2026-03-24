import type { Subsystem, NodeDef, ExecContext, NodeId } from "@svg-os/core";

// ── SVG Template Node ─────────────────────────────────────────────────────────

const svgTemplateNodeDef: NodeDef = {
  type: "view:svg-template",
  subsystem: "view",
  inputs: [
    { name: "in", type: "any", optional: true },
    { name: "data", type: "data", optional: true },
  ],
  outputs: [
    { name: "out", type: "any" },
    { name: "renderData", type: "data" },
  ],
  execute(ctx: ExecContext, nodeId: NodeId) {
    const config = ctx.getConfig(nodeId);
    const inputData = (ctx.getInput(nodeId, "in") ?? ctx.getInput(nodeId, "data")) as Record<string, unknown>;

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
    ctx.setOutput(nodeId, "out", mergedData);
    ctx.setOutput(nodeId, "renderData", mergedData);
  },
};

// ── Note Node ─────────────────────────────────────────────────────────────────

const noteNodeDef: NodeDef = {
  type: "view:note",
  subsystem: "view",
  inputs: [
    { name: "in", type: "any", optional: true },
    { name: "data", type: "data", optional: true },
  ],
  outputs: [
    { name: "out", type: "any" },
    { name: "text", type: "text" },
  ],
  execute(ctx: ExecContext, nodeId: NodeId) {
    const config = ctx.getConfig(nodeId);
    let content = (config.content as string) || "";
    const input = (ctx.getInput(nodeId, "in") ?? ctx.getInput(nodeId, "data")) as Record<string, unknown>;

    // Interpolate {{field}} placeholders from upstream
    if (input && typeof input === "object" && Object.keys(input).length > 0) {
      content = content.replace(/\{\{(\w+)\}\}/g, (_m: string, field: string) => {
        return (input as Record<string, unknown>)[field] != null ? String((input as Record<string, unknown>)[field]) : "";
      });
    }

    // Pass-through: output same data that came in
    ctx.setOutput(nodeId, "out", input || content);
    ctx.setOutput(nodeId, "text", content);
  },
};

// ── WebView Node ──────────────────────────────────────────────────────────────

const webviewNodeDef: NodeDef = {
  type: "view:webview",
  subsystem: "view",
  inputs: [
    { name: "in", type: "any", optional: true },
    { name: "url", type: "text", optional: true },
  ],
  outputs: [
    { name: "out", type: "any" },
    { name: "url", type: "text" },
  ],
  execute(ctx: ExecContext, nodeId: NodeId) {
    const config = ctx.getConfig(nodeId);
    const upstream = ctx.getInput(nodeId, "in") as string | undefined;
    const inputUrl = (ctx.getInput(nodeId, "url") as string) || upstream;
    const url = inputUrl || (config.url as string) || "";

    // Store resolved URL for canvas to render
    const metadata = { url, title: config.title || "", status: "loaded" };
    ctx.setOutput(nodeId, "out", metadata);
    ctx.setOutput(nodeId, "url", url);
  },
};

// ── Metric Node ───────────────────────────────────────────────────────────────

const metricNodeDef: NodeDef = {
  type: "view:metric",
  subsystem: "view",
  inputs: [
    { name: "in", type: "any", optional: true },
    { name: "value", type: "number", optional: true },
    { name: "label", type: "text", optional: true },
  ],
  outputs: [
    { name: "out", type: "any" },
    { name: "display", type: "data" },
  ],
  execute(ctx: ExecContext, nodeId: NodeId) {
    const config = ctx.getConfig(nodeId);
    const upstream = ctx.getInput(nodeId, "in");
    const value = ctx.getInput(nodeId, "value") ?? upstream ?? config.value ?? 0;
    const label = (ctx.getInput(nodeId, "label") as string) ?? (config.label as string) ?? "Value";

    const display = { value, label };
    ctx.setOutput(nodeId, "out", display);
    ctx.setOutput(nodeId, "display", display);
  },
};

// ── Chart Node (stub) ─────────────────────────────────────────────────────────

const chartNodeDef: NodeDef = {
  type: "view:chart",
  subsystem: "view",
  inputs: [
    { name: "in", type: "any", optional: true },
    { name: "data", type: "array", optional: true },
  ],
  outputs: [
    { name: "out", type: "any" },
    { name: "image", type: "image", optional: true },
    { name: "chartData", type: "array", optional: true },
  ],
  execute(ctx: ExecContext, nodeId: NodeId) {
    const data = ctx.getInput(nodeId, "in") ?? ctx.getInput(nodeId, "data");
    // Chart rendering delegated to canvas layer (D3 or similar)
    ctx.setOutput(nodeId, "out", data);
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
