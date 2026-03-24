import type { Subsystem, NodeDef, ExecContext } from "@svg-os/core";

// ── Node definitions ──────────────────────────────────────────────────

// data:json — static JSON source
const jsonNodeDef: NodeDef = {
  type: "data:json",
  subsystem: "data",
  description: "Static JSON data source",
  trigger: "auto",
  inputs: [{ name: "in", type: "any", optional: true }],
  outputs: [
    { name: "data", type: "data" },
  ],
  execute(ctx: ExecContext) {
    const config = ctx.getConfig();
    const raw = (config.json as string) || "{}";
    const upstream = ctx.getInput("in") as Record<string, unknown> | undefined;
    try {
      const parsed = JSON.parse(raw);
      const result = upstream && typeof upstream === "object"
        ? { ...parsed, ...upstream }
        : parsed;
      ctx.setOutput("data", result);
    } catch {
      const result = upstream && typeof upstream === "object" ? upstream : {};
      ctx.setOutput("data", result);
    }
  },
};

// data:table — tabular data with optional row selection
const tableNodeDef: NodeDef = {
  type: "data:table",
  subsystem: "data",
  description: "Tabular data with row selection",
  trigger: "auto",
  inputs: [
    { name: "in", type: "any", optional: true },
    { name: "data", type: "array", optional: true },
  ],
  outputs: [
    { name: "rows", type: "array" },
    { name: "selected", type: "data", optional: true },
  ],
  execute(ctx: ExecContext) {
    const config = ctx.getConfig();
    const inputData = ctx.getInput("in") ?? ctx.getInput("data");

    let rows: unknown[];
    if (Array.isArray(inputData)) {
      rows = inputData;
    } else {
      try {
        rows = JSON.parse((config.dataJson as string) || "[]");
      } catch {
        rows = [];
      }
    }

    ctx.setOutput("rows", rows);

    const selectedIndex = config.selectedRow as number;
    if (
      typeof selectedIndex === "number" &&
      selectedIndex >= 0 &&
      selectedIndex < rows.length
    ) {
      ctx.setOutput("selected", rows[selectedIndex]);
    }
  },
};

// data:transform — evaluate a JS expression against input data
const transformNodeDef: NodeDef = {
  type: "data:transform",
  subsystem: "data",
  description: "Evaluate JS expression against input",
  trigger: "auto",
  inputs: [
    { name: "in", type: "any", optional: true },
    { name: "input", type: "data", optional: true },
  ],
  outputs: [
    { name: "output", type: "data" },
  ],
  execute(ctx: ExecContext) {
    const config = ctx.getConfig();
    const input =
      (ctx.getInput("in") ?? ctx.getInput("input")) as Record<string, unknown> || {};
    const expression = (config.expression as string) || "input.value";

    try {
      const dataSetup = `const input = ${JSON.stringify(input)}; const $ = input; const data = input;`;
      const result = new Function(
        `"use strict"; ${dataSetup} return (${expression})`,
      )();
      const output = typeof result === "object" && result !== null
        ? result
        : { value: result };
      ctx.setOutput("output", output);
    } catch {
      ctx.setOutput("output", input); // pass through on error
    }
  },
};

// data:filter — filter an array with a JS predicate
const filterNodeDef: NodeDef = {
  type: "data:filter",
  subsystem: "data",
  description: "Filter array with JS predicate",
  trigger: "auto",
  inputs: [
    { name: "in", type: "any", optional: true },
    { name: "input", type: "array", optional: true },
  ],
  outputs: [
    { name: "output", type: "array" },
  ],
  execute(ctx: ExecContext) {
    const config = ctx.getConfig();
    const input = ctx.getInput("in") ?? ctx.getInput("input");
    const predicate = (config.predicate as string) || "true";

    if (!Array.isArray(input)) {
      ctx.setOutput("output", []);
      return;
    }

    try {
      const fn = new Function(
        "item",
        "index",
        `"use strict"; return (${predicate})`,
      );
      const filtered = input.filter((item, index) => fn(item, index));
      ctx.setOutput("output", filtered);
    } catch {
      ctx.setOutput("output", input);
    }
  },
};

// data:merge — shallow-merge two objects
const mergeNodeDef: NodeDef = {
  type: "data:merge",
  subsystem: "data",
  description: "Shallow-merge two objects",
  trigger: "auto",
  inputs: [
    { name: "in", type: "any", optional: true },
    { name: "a", type: "data", optional: true },
    { name: "b", type: "data", optional: true },
  ],
  outputs: [
    { name: "merged", type: "data" },
  ],
  execute(ctx: ExecContext) {
    const upstream =
      (ctx.getInput("in") as Record<string, unknown>) || {};
    const a =
      (ctx.getInput("a") as Record<string, unknown>) || {};
    const b =
      (ctx.getInput("b") as Record<string, unknown>) || {};
    const result = { ...upstream, ...a, ...b };
    ctx.setOutput("merged", result);
  },
};

// data:fetch — HTTP fetch with JSON auto-parse
const fetchNodeDef: NodeDef = {
  type: "data:fetch",
  subsystem: "data",
  description: "HTTP fetch with JSON auto-parse",
  trigger: "once",
  inputs: [
    { name: "in", type: "any", optional: true },
    { name: "url", type: "text", optional: true },
  ],
  outputs: [
    { name: "response", type: "data" },
  ],
  capabilities: [{ subsystem: "data", action: "network" }],
  execution: { mode: "async", concurrencyKey: "network:fetch" },
  async execute(ctx: ExecContext) {
    const config = ctx.getConfig();
    const inputUrl = (ctx.getInput("in") as string) || (ctx.getInput("url") as string);
    const url = inputUrl || (config.url as string) || "";

    if (!url) {
      ctx.setOutput("response", { error: "No URL" });
      return;
    }

    try {
      const resp = await fetch(url);
      const contentType = resp.headers.get("content-type") || "";

      let result: unknown;
      if (contentType.includes("json")) {
        result = await resp.json();
      } else {
        result = {
          text: await resp.text(),
          status: resp.status,
        };
      }
      ctx.setOutput("response", result);
    } catch (err) {
      ctx.setOutput("response", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },
};

// data:ai — LLM completion via Anthropic Messages API
const aiNodeDef: NodeDef = {
  type: "data:ai",
  subsystem: "data",
  description: "LLM completion via Claude API",
  trigger: "manual",
  inputs: [
    { name: "in", type: "any", optional: true },
    { name: "prompt", type: "text", optional: true },
    { name: "context", type: "data", optional: true },
  ],
  outputs: [
    { name: "response", type: "text" },
  ],
  capabilities: [
    { subsystem: "data", action: "network", scope: "api.anthropic.com" },
  ],
  execution: { mode: "exclusive", concurrencyKey: "network:anthropic" },
  async execute(ctx: ExecContext) {
    const config = ctx.getConfig();
    const inputPrompt = (ctx.getInput("in") as string) || (ctx.getInput("prompt") as string);
    const context = ctx.getInput("context") as Record<string, unknown>;

    const prompt = inputPrompt || (config.prompt as string) || "";
    const apiKey = (config.apiKey as string) || "";
    const model = (config.model as string) || "claude-opus-4-6";

    if (!prompt || !apiKey) {
      ctx.setOutput("response", "");
      return;
    }

    // Interpolate {{field}} placeholders from context
    let resolvedPrompt = prompt;
    if (context && typeof context === "object") {
      resolvedPrompt = prompt.replace(
        /\{\{(\w+)\}\}/g,
        (_m: string, field: string) => {
          return context[field] != null
            ? String(context[field])
            : `{{${field}}}`;
        },
      );
    }

    try {
      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify({
          model,
          max_tokens: 4096,
          messages: [{ role: "user", content: resolvedPrompt }],
        }),
      });

      const data = await resp.json();
      const text =
        data.content
          ?.map((block: { type: string; text?: string }) =>
            block.type === "text" ? block.text : "",
          )
          .join("") || "";

      ctx.setOutput("response", text);
    } catch (err) {
      ctx.setOutput("response", `Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
};

// ── Subsystem export ──────────────────────────────────────────────────

export const dataSubsystem: Subsystem = {
  id: "data",
  name: "Data",
  nodeTypes: [
    jsonNodeDef,
    tableNodeDef,
    transformNodeDef,
    filterNodeDef,
    mergeNodeDef,
    fetchNodeDef,
    aiNodeDef,
  ],
  init(_runtime: unknown) {
    // No async init needed for data subsystem
  },
};
