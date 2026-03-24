import type { Subsystem, NodeDef, ExecContext, NodeId } from "@svg-os/core";

// ── Node definitions ──────────────────────────────────────────────────

// data:json — static JSON source
const jsonNodeDef: NodeDef = {
  type: "data:json",
  subsystem: "data",
  inputs: [{ name: "in", type: "any", optional: true }],
  outputs: [
    { name: "out", type: "any" },
    { name: "data", type: "data" },
  ],
  execute(ctx: ExecContext, nodeId: NodeId) {
    const config = ctx.getConfig(nodeId);
    const raw = (config.json as string) || "{}";
    const upstream = ctx.getInput(nodeId, "in") as Record<string, unknown> | undefined;
    try {
      const parsed = JSON.parse(raw);
      // If there's upstream input, merge it with the node's own data
      const result = upstream && typeof upstream === "object"
        ? { ...parsed, ...upstream }
        : parsed;
      ctx.setOutput(nodeId, "out", result);
      ctx.setOutput(nodeId, "data", result);
    } catch {
      const result = upstream && typeof upstream === "object" ? upstream : {};
      ctx.setOutput(nodeId, "out", result);
      ctx.setOutput(nodeId, "data", result);
    }
  },
};

// data:table — tabular data with optional row selection
const tableNodeDef: NodeDef = {
  type: "data:table",
  subsystem: "data",
  inputs: [
    { name: "in", type: "any", optional: true },
    { name: "data", type: "array", optional: true },
  ],
  outputs: [
    { name: "out", type: "any" },
    { name: "rows", type: "array" },
    { name: "selected", type: "data", optional: true },
  ],
  execute(ctx: ExecContext, nodeId: NodeId) {
    const config = ctx.getConfig(nodeId);
    const inputData = ctx.getInput(nodeId, "in") ?? ctx.getInput(nodeId, "data");

    // Use input data if connected, otherwise use config
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

    ctx.setOutput(nodeId, "rows", rows);

    // Selected row
    const selectedIndex = config.selectedRow as number;
    if (
      typeof selectedIndex === "number" &&
      selectedIndex >= 0 &&
      selectedIndex < rows.length
    ) {
      ctx.setOutput(nodeId, "selected", rows[selectedIndex]);
      ctx.setOutput(nodeId, "out", rows[selectedIndex]);
    } else {
      ctx.setOutput(nodeId, "out", rows);
    }
  },
};

// data:transform — evaluate a JS expression against input data
const transformNodeDef: NodeDef = {
  type: "data:transform",
  subsystem: "data",
  inputs: [
    { name: "in", type: "any", optional: true },
    { name: "input", type: "data", optional: true },
  ],
  outputs: [
    { name: "out", type: "any" },
    { name: "output", type: "data" },
  ],
  execute(ctx: ExecContext, nodeId: NodeId) {
    const config = ctx.getConfig(nodeId);
    const input =
      (ctx.getInput(nodeId, "in") ?? ctx.getInput(nodeId, "input")) as Record<string, unknown> || {};
    const expression = (config.expression as string) || "input.value";

    try {
      const dataSetup = `const input = ${JSON.stringify(input)}; const $ = input; const data = input;`;
      const result = new Function(
        `"use strict"; ${dataSetup} return (${expression})`,
      )();
      const output = typeof result === "object" && result !== null
        ? result
        : { value: result };
      ctx.setOutput(nodeId, "out", output);
      ctx.setOutput(nodeId, "output", output);
    } catch {
      ctx.setOutput(nodeId, "out", input); // pass through on error
      ctx.setOutput(nodeId, "output", input);
    }
  },
};

// data:filter — filter an array with a JS predicate
const filterNodeDef: NodeDef = {
  type: "data:filter",
  subsystem: "data",
  inputs: [
    { name: "in", type: "any", optional: true },
    { name: "input", type: "array", optional: true },
  ],
  outputs: [
    { name: "out", type: "any" },
    { name: "output", type: "array" },
  ],
  execute(ctx: ExecContext, nodeId: NodeId) {
    const config = ctx.getConfig(nodeId);
    const input = ctx.getInput(nodeId, "in") ?? ctx.getInput(nodeId, "input");
    const predicate = (config.predicate as string) || "true";

    if (!Array.isArray(input)) {
      ctx.setOutput(nodeId, "out", []);
      ctx.setOutput(nodeId, "output", []);
      return;
    }

    try {
      const fn = new Function(
        "item",
        "index",
        `"use strict"; return (${predicate})`,
      );
      const filtered = input.filter((item, index) => fn(item, index));
      ctx.setOutput(nodeId, "out", filtered);
      ctx.setOutput(nodeId, "output", filtered);
    } catch {
      ctx.setOutput(nodeId, "out", input);
      ctx.setOutput(nodeId, "output", input);
    }
  },
};

// data:merge — shallow-merge two objects
const mergeNodeDef: NodeDef = {
  type: "data:merge",
  subsystem: "data",
  inputs: [
    { name: "in", type: "any", optional: true },
    { name: "a", type: "data", optional: true },
    { name: "b", type: "data", optional: true },
  ],
  outputs: [
    { name: "out", type: "any" },
    { name: "merged", type: "data" },
  ],
  execute(ctx: ExecContext, nodeId: NodeId) {
    const upstream =
      (ctx.getInput(nodeId, "in") as Record<string, unknown>) || {};
    const a =
      (ctx.getInput(nodeId, "a") as Record<string, unknown>) || {};
    const b =
      (ctx.getInput(nodeId, "b") as Record<string, unknown>) || {};
    const result = { ...upstream, ...a, ...b };
    ctx.setOutput(nodeId, "out", result);
    ctx.setOutput(nodeId, "merged", result);
  },
};

// data:fetch — HTTP fetch with JSON auto-parse
const fetchNodeDef: NodeDef = {
  type: "data:fetch",
  subsystem: "data",
  inputs: [
    { name: "in", type: "any", optional: true },
    { name: "url", type: "text", optional: true },
  ],
  outputs: [
    { name: "out", type: "any" },
    { name: "response", type: "data" },
  ],
  capabilities: [{ subsystem: "data", action: "network" }],
  execution: { mode: "async", concurrencyKey: "network:fetch" },
  async execute(ctx: ExecContext, nodeId: NodeId) {
    const config = ctx.getConfig(nodeId);
    const inputUrl = (ctx.getInput(nodeId, "in") as string) || (ctx.getInput(nodeId, "url") as string);
    const url = inputUrl || (config.url as string) || "";

    if (!url) {
      ctx.setOutput(nodeId, "out", { error: "No URL" });
      ctx.setOutput(nodeId, "response", { error: "No URL" });
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
      ctx.setOutput(nodeId, "out", result);
      ctx.setOutput(nodeId, "response", result);
    } catch (err) {
      const errResult = {
        error: err instanceof Error ? err.message : String(err),
      };
      ctx.setOutput(nodeId, "out", errResult);
      ctx.setOutput(nodeId, "response", errResult);
    }
  },
};

// data:ai — LLM completion via Anthropic Messages API
const aiNodeDef: NodeDef = {
  type: "data:ai",
  subsystem: "data",
  inputs: [
    { name: "in", type: "any", optional: true },
    { name: "prompt", type: "text", optional: true },
    { name: "context", type: "data", optional: true },
  ],
  outputs: [
    { name: "out", type: "any" },
    { name: "response", type: "text" },
  ],
  capabilities: [
    { subsystem: "data", action: "network", scope: "api.anthropic.com" },
  ],
  execution: { mode: "exclusive", concurrencyKey: "network:anthropic" },
  async execute(ctx: ExecContext, nodeId: NodeId) {
    const config = ctx.getConfig(nodeId);
    const inputPrompt = (ctx.getInput(nodeId, "in") as string) || (ctx.getInput(nodeId, "prompt") as string);
    const context = ctx.getInput(nodeId, "context") as Record<
      string,
      unknown
    >;

    const prompt = inputPrompt || (config.prompt as string) || "";
    const apiKey = (config.apiKey as string) || "";
    const model = (config.model as string) || "claude-opus-4-6";

    if (!prompt || !apiKey) {
      ctx.setOutput(nodeId, "out", "");
      ctx.setOutput(nodeId, "response", "");
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

      ctx.setOutput(nodeId, "out", text);
      ctx.setOutput(nodeId, "response", text);
    } catch (err) {
      const errMsg = `Error: ${err instanceof Error ? err.message : String(err)}`;
      ctx.setOutput(nodeId, "out", errMsg);
      ctx.setOutput(nodeId, "response", errMsg);
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
