import type { Subsystem, NodeDef, ExecContext } from "@svg-os/core";

// ── SVG Template Node ─────────────────────────────────────────────────────────

const svgTemplateNodeDef: NodeDef = {
  type: "view:svg-template",
  subsystem: "view",
  description: "SVG template with data binding",
  trigger: "auto",
  inputs: [
    { name: "in", type: "any", optional: true },
    { name: "data", type: "data", optional: true },
  ],
  outputs: [
    { name: "renderData", type: "data" },
  ],
  execute(ctx: ExecContext) {
    const config = ctx.getConfig();
    const inputData = (ctx.getInput("in") ?? ctx.getInput("data")) as Record<string, unknown>;

    let ownData: Record<string, unknown> = {};
    try {
      const d = config.data as string;
      if (d) ownData = JSON.parse(d);
    } catch { /* */ }

    const mergedData = { ...ownData, ...inputData };
    ctx.setOutput("renderData", mergedData);
  },
};

// ── Note Node ─────────────────────────────────────────────────────────────────

const noteNodeDef: NodeDef = {
  type: "view:note",
  subsystem: "view",
  description: "Rich text with {{field}} interpolation",
  trigger: "auto",
  inputs: [
    { name: "in", type: "any", optional: true },
    { name: "data", type: "data", optional: true },
  ],
  outputs: [
    { name: "text", type: "text" },
  ],
  execute(ctx: ExecContext) {
    const config = ctx.getConfig();
    let content = (config.content as string) || "";
    const input = (ctx.getInput("in") ?? ctx.getInput("data")) as Record<string, unknown>;

    if (input && typeof input === "object" && Object.keys(input).length > 0) {
      content = content.replace(/\{\{(\w+)\}\}/g, (_m: string, field: string) => {
        return (input as Record<string, unknown>)[field] != null ? String((input as Record<string, unknown>)[field]) : "";
      });
    }

    ctx.setOutput("text", content);
  },
};

// ── WebView Node ──────────────────────────────────────────────────────────────

const webviewNodeDef: NodeDef = {
  type: "view:webview",
  subsystem: "view",
  description: "Embed web page in iframe",
  trigger: "auto",
  inputs: [
    { name: "in", type: "any", optional: true },
    { name: "url", type: "text", optional: true },
  ],
  outputs: [
    { name: "url", type: "text" },
  ],
  execute(ctx: ExecContext) {
    const config = ctx.getConfig();
    const upstream = ctx.getInput("in") as string | undefined;
    const inputUrl = (ctx.getInput("url") as string) || upstream;
    const url = inputUrl || (config.url as string) || "";
    ctx.setOutput("url", url);
  },
};

// ── Metric Node ───────────────────────────────────────────────────────────────

const metricNodeDef: NodeDef = {
  type: "view:metric",
  subsystem: "view",
  description: "Numeric display with label",
  trigger: "auto",
  inputs: [
    { name: "in", type: "any", optional: true },
    { name: "value", type: "number", optional: true },
    { name: "label", type: "text", optional: true },
  ],
  outputs: [
    { name: "display", type: "data" },
  ],
  execute(ctx: ExecContext) {
    const config = ctx.getConfig();
    const upstream = ctx.getInput("in");
    const value = ctx.getInput("value") ?? upstream ?? config.value ?? 0;
    const label = (ctx.getInput("label") as string) ?? (config.label as string) ?? "Value";

    const display = { value, label };
    ctx.setOutput("display", display);
  },
};

// ── Chart Node (stub) ─────────────────────────────────────────────────────────

const chartNodeDef: NodeDef = {
  type: "view:chart",
  subsystem: "view",
  description: "Data visualization chart",
  trigger: "auto",
  inputs: [
    { name: "in", type: "any", optional: true },
    { name: "data", type: "array", optional: true },
  ],
  outputs: [
    { name: "chartData", type: "array", optional: true },
  ],
  execute(ctx: ExecContext) {
    const data = ctx.getInput("in") ?? ctx.getInput("data");
    ctx.setOutput("chartData", data);
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
  },
};
