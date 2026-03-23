import type { Subsystem, NodeDef, ExecContext, NodeId } from "@svg-os/core";

// ── Terminal Node ─────────────────────────────────────────────────────────────

const terminalNodeDef: NodeDef = {
  type: "sys:terminal",
  subsystem: "system",
  inputs: [{ name: "stdin", type: "text", optional: true }],
  outputs: [
    { name: "stdout", type: "text" },
    { name: "result", type: "data" },
  ],
  capabilities: [{ subsystem: "system", action: "execute" }],
  async execute(ctx: ExecContext, nodeId: NodeId) {
    const config = ctx.getConfig(nodeId);
    const history = config.history as string || "[]";
    const mode = (config.mode as string) || "js";

    // Find last input command
    try {
      const entries = JSON.parse(history) as Array<{ type: string; text: string }>;
      const lastInput = [...entries].reverse().find(e => e.type === "input");
      if (lastInput) {
        // Execution is handled by the canvas layer (code-runner.ts)
        // The subsystem just declares the contract
        ctx.setOutput(nodeId, "stdout", lastInput.text);
        ctx.setOutput(nodeId, "result", { command: lastInput.text, mode });
      }
    } catch { /* */ }
  },
};

// ── Notebook Node ─────────────────────────────────────────────────────────────

const notebookNodeDef: NodeDef = {
  type: "sys:notebook",
  subsystem: "system",
  inputs: [{ name: "data", type: "data", optional: true }],
  outputs: [
    { name: "all", type: "data" },
    // Dynamic cell outputs are added at runtime
  ],
  capabilities: [{ subsystem: "system", action: "execute" }],
  execute(ctx: ExecContext, nodeId: NodeId) {
    const config = ctx.getConfig(nodeId);
    const cellsJson = (config.cells as string) || "[]";

    try {
      const cells = JSON.parse(cellsJson) as Array<{
        id: string;
        type: string;
        lang: string;
        output: string;
      }>;

      // Merge all code cell outputs into one object
      const allOutputs: Record<string, unknown> = {};
      const codeCells = cells.filter(c => c.type === "code");

      for (let i = 0; i < codeCells.length; i++) {
        const cell = codeCells[i];
        if (cell.output) {
          try {
            const parsed = JSON.parse(cell.output);
            if (typeof parsed === "object" && parsed !== null) {
              Object.assign(allOutputs, parsed);
            } else {
              allOutputs[`cell${i}`] = parsed;
            }
          } catch {
            allOutputs[`cell${i}`] = cell.output;
          }
          // Set per-cell output
          ctx.setOutput(nodeId, `cell:${i}`, allOutputs[`cell${i}`] || cell.output);
        }
      }

      ctx.setOutput(nodeId, "all", allOutputs);
    } catch { /* */ }
  },
};

// ── File Read Node ────────────────────────────────────────────────────────────

const fileReadNodeDef: NodeDef = {
  type: "sys:file-read",
  subsystem: "system",
  inputs: [{ name: "path", type: "text" }],
  outputs: [
    { name: "content", type: "text" },
    { name: "meta", type: "data" },
  ],
  capabilities: [{ subsystem: "system", action: "fs", scope: "read" }],
  async execute(ctx: ExecContext, nodeId: NodeId) {
    const config = ctx.getConfig(nodeId);
    const inputPath = ctx.getInput(nodeId, "path") as string;
    const path = inputPath || (config.path as string) || "";

    if (!path) {
      ctx.setOutput(nodeId, "content", "");
      ctx.setOutput(nodeId, "meta", { error: "No path specified" });
      return;
    }

    // Browser environment: use fetch for local files or handle File API
    try {
      const resp = await fetch(path);
      const text = await resp.text();
      ctx.setOutput(nodeId, "content", text);
      ctx.setOutput(nodeId, "meta", {
        path,
        size: text.length,
        type: resp.headers.get("content-type") || "text/plain",
      });
    } catch (err) {
      ctx.setOutput(nodeId, "content", "");
      ctx.setOutput(nodeId, "meta", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },
};

// ── Env Node ──────────────────────────────────────────────────────────────────

const envNodeDef: NodeDef = {
  type: "sys:env",
  subsystem: "system",
  inputs: [],
  outputs: [{ name: "vars", type: "data" }],
  execute(ctx: ExecContext, nodeId: NodeId) {
    // In browser, expose limited environment info
    ctx.setOutput(nodeId, "vars", {
      userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "unknown",
      language: typeof navigator !== "undefined" ? navigator.language : "en",
      platform: typeof navigator !== "undefined" ? navigator.platform : "unknown",
      url: typeof location !== "undefined" ? location.href : "",
      timestamp: Date.now(),
    });
  },
};

// ── System Subsystem ──────────────────────────────────────────────────────────

export const systemSubsystem: Subsystem = {
  id: "system",
  name: "System",
  nodeTypes: [
    terminalNodeDef,
    notebookNodeDef,
    fileReadNodeDef,
    envNodeDef,
  ],
  init(_runtime) {
    // System subsystem is ready immediately
  },
};
