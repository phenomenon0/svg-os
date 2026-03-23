import type { Subsystem, NodeDef, ExecContext, NodeId } from "@svg-os/core";

// ── Node definitions ──────────────────────────────────────────────────

// data:json — static JSON source
const jsonNodeDef: NodeDef = {
  type: "data:json",
  subsystem: "data",
  inputs: [],
  outputs: [{ name: "data", type: "data" }],
  execute(ctx: ExecContext, nodeId: NodeId) {
    const config = ctx.getConfig(nodeId);
    const raw = (config.json as string) || "{}";
    try {
      const parsed = JSON.parse(raw);
      ctx.setOutput(nodeId, "data", parsed);
    } catch {
      ctx.setOutput(nodeId, "data", {});
    }
  },
};

// data:table — tabular data with optional row selection
const tableNodeDef: NodeDef = {
  type: "data:table",
  subsystem: "data",
  inputs: [{ name: "data", type: "array", optional: true }],
  outputs: [
    { name: "rows", type: "array" },
    { name: "selected", type: "data", optional: true },
  ],
  execute(ctx: ExecContext, nodeId: NodeId) {
    const config = ctx.getConfig(nodeId);
    const inputData = ctx.getInput(nodeId, "data");

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
    }
  },
};

// data:transform — evaluate a JS expression against input data
const transformNodeDef: NodeDef = {
  type: "data:transform",
  subsystem: "data",
  inputs: [{ name: "input", type: "data" }],
  outputs: [{ name: "output", type: "data" }],
  execute(ctx: ExecContext, nodeId: NodeId) {
    const config = ctx.getConfig(nodeId);
    const input =
      (ctx.getInput(nodeId, "input") as Record<string, unknown>) || {};
    const expression = (config.expression as string) || "$.value";

    try {
      const dataSetup = `const $ = ${JSON.stringify(input)}; const data = $;`;
      const result = new Function(
        `"use strict"; ${dataSetup} return (${expression})`,
      )();
      ctx.setOutput(
        nodeId,
        "output",
        typeof result === "object" && result !== null
          ? result
          : { value: result },
      );
    } catch {
      ctx.setOutput(nodeId, "output", input); // pass through on error
    }
  },
};

// data:filter — filter an array with a JS predicate
const filterNodeDef: NodeDef = {
  type: "data:filter",
  subsystem: "data",
  inputs: [{ name: "input", type: "array" }],
  outputs: [{ name: "output", type: "array" }],
  execute(ctx: ExecContext, nodeId: NodeId) {
    const config = ctx.getConfig(nodeId);
    const input = ctx.getInput(nodeId, "input");
    const predicate = (config.predicate as string) || "true";

    if (!Array.isArray(input)) {
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
      ctx.setOutput(nodeId, "output", filtered);
    } catch {
      ctx.setOutput(nodeId, "output", input);
    }
  },
};

// data:merge — shallow-merge two objects
const mergeNodeDef: NodeDef = {
  type: "data:merge",
  subsystem: "data",
  inputs: [
    { name: "a", type: "data" },
    { name: "b", type: "data" },
  ],
  outputs: [{ name: "merged", type: "data" }],
  execute(ctx: ExecContext, nodeId: NodeId) {
    const a =
      (ctx.getInput(nodeId, "a") as Record<string, unknown>) || {};
    const b =
      (ctx.getInput(nodeId, "b") as Record<string, unknown>) || {};
    ctx.setOutput(nodeId, "merged", { ...a, ...b });
  },
};

// data:fetch — HTTP fetch with JSON auto-parse
const fetchNodeDef: NodeDef = {
  type: "data:fetch",
  subsystem: "data",
  inputs: [{ name: "url", type: "text", optional: true }],
  outputs: [{ name: "response", type: "data" }],
  capabilities: [{ subsystem: "data", action: "network" }],
  async execute(ctx: ExecContext, nodeId: NodeId) {
    const config = ctx.getConfig(nodeId);
    const inputUrl = ctx.getInput(nodeId, "url") as string;
    const url = inputUrl || (config.url as string) || "";

    if (!url) {
      ctx.setOutput(nodeId, "response", { error: "No URL" });
      return;
    }

    try {
      const resp = await fetch(url);
      const contentType = resp.headers.get("content-type") || "";

      if (contentType.includes("json")) {
        ctx.setOutput(nodeId, "response", await resp.json());
      } else {
        ctx.setOutput(nodeId, "response", {
          text: await resp.text(),
          status: resp.status,
        });
      }
    } catch (err) {
      ctx.setOutput(nodeId, "response", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },
};

// data:ai — LLM completion via Anthropic Messages API
const aiNodeDef: NodeDef = {
  type: "data:ai",
  subsystem: "data",
  inputs: [
    { name: "prompt", type: "text", optional: true },
    { name: "context", type: "data", optional: true },
  ],
  outputs: [{ name: "response", type: "text" }],
  capabilities: [
    { subsystem: "data", action: "network", scope: "api.anthropic.com" },
  ],
  async execute(ctx: ExecContext, nodeId: NodeId) {
    const config = ctx.getConfig(nodeId);
    const inputPrompt = ctx.getInput(nodeId, "prompt") as string;
    const context = ctx.getInput(nodeId, "context") as Record<
      string,
      unknown
    >;

    const prompt = inputPrompt || (config.prompt as string) || "";
    const apiKey = (config.apiKey as string) || "";
    const model = (config.model as string) || "claude-opus-4-6";

    if (!prompt || !apiKey) {
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

      ctx.setOutput(nodeId, "response", text);
    } catch (err) {
      ctx.setOutput(nodeId, "response",
        `Error: ${err instanceof Error ? err.message : String(err)}`,
      );
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
