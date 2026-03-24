/**
 * System Subsystem — real OS primitives via browser APIs.
 *
 * Core nodes: file-open, file-write, folder, clipboard, terminal, notebook, env
 * Novelty nodes (disk, processes, screen-capture, notify, network, geolocation)
 * have been removed — they can be re-added as plugins.
 */

import type { Subsystem, NodeDef, ExecContext } from "@svg-os/core";
import { executeNotebook, executeTerminal } from "./execution";

// ── File Open Node ───────────────────────────────────────────────────────────

const fileHandleStore = new Map<string, FileSystemFileHandle>();

const fileOpenNodeDef: NodeDef = {
  type: "sys:file-open",
  subsystem: "system",
  description: "Open a file from the filesystem",
  trigger: "manual",
  inputs: [{ name: "in", type: "any", optional: true }],
  outputs: [
    { name: "content", type: "text" },
    { name: "meta", type: "data" },
  ],
  capabilities: [{ subsystem: "system", action: "fs", scope: "read" }],
  async execute(ctx: ExecContext) {
    const handle = fileHandleStore.get(ctx.nodeId);
    if (!handle) {
      ctx.setOutput("content", "");
      ctx.setOutput("meta", { error: "No file selected. Use the picker." });
      return;
    }

    try {
      const file = await handle.getFile();
      const text = await file.text();
      const meta = {
        name: file.name,
        size: file.size,
        type: file.type || "text/plain",
        lastModified: file.lastModified,
      };
      ctx.setOutput("content", text);
      ctx.setOutput("meta", meta);
    } catch (err) {
      ctx.setOutput("content", "");
      ctx.setOutput("meta", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },
};

export async function pickFile(nodeId: string): Promise<{ name: string } | null> {
  if (!("showOpenFilePicker" in window)) return null;
  try {
    const [handle] = await (window as any).showOpenFilePicker({
      multiple: false,
    });
    fileHandleStore.set(nodeId, handle);
    return { name: handle.name };
  } catch {
    return null;
  }
}

// ── File Write Node ──────────────────────────────────────────────────────────

const fileWriteNodeDef: NodeDef = {
  type: "sys:file-write",
  subsystem: "system",
  description: "Save content to a file",
  trigger: "manual",
  inputs: [
    { name: "in", type: "any", optional: true },
    { name: "content", type: "text", optional: true },
    { name: "filename", type: "text", optional: true },
  ],
  outputs: [
    { name: "ok", type: "boolean" },
    { name: "meta", type: "data" },
  ],
  capabilities: [{ subsystem: "system", action: "fs", scope: "write" }],
  async execute(ctx: ExecContext) {
    const upstream = ctx.getInput("in") as string | undefined;
    const content = (ctx.getInput("content") as string) || upstream || "";
    const config = ctx.getConfig();
    const filename = (ctx.getInput("filename") as string) || (config.filename as string) || "untitled.txt";

    if (!("showSaveFilePicker" in window)) {
      try {
        const blob = new Blob([content], { type: "text/plain" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
        ctx.setOutput("ok", true);
        ctx.setOutput("meta", { method: "download", filename });
      } catch (err) {
        ctx.setOutput("ok", false);
        ctx.setOutput("meta", { error: err instanceof Error ? err.message : String(err) });
      }
      return;
    }

    try {
      const handle = await (window as any).showSaveFilePicker({
        suggestedName: filename,
      });
      const writable = await handle.createWritable();
      await writable.write(content);
      await writable.close();
      ctx.setOutput("ok", true);
      ctx.setOutput("meta", { name: handle.name, method: "filesystem" });
    } catch (err) {
      ctx.setOutput("ok", false);
      ctx.setOutput("meta", { error: err instanceof Error ? err.message : String(err) });
    }
  },
};

// ── Folder Node ──────────────────────────────────────────────────────────────

const dirHandleStore = new Map<string, FileSystemDirectoryHandle>();

const folderNodeDef: NodeDef = {
  type: "sys:folder",
  subsystem: "system",
  description: "List directory contents",
  trigger: "manual",
  inputs: [{ name: "in", type: "any", optional: true }],
  outputs: [
    { name: "entries", type: "array" },
    { name: "meta", type: "data" },
  ],
  capabilities: [{ subsystem: "system", action: "fs", scope: "read" }],
  async execute(ctx: ExecContext) {
    const handle = dirHandleStore.get(ctx.nodeId);
    if (!handle) {
      ctx.setOutput("entries", []);
      ctx.setOutput("meta", { error: "No folder selected. Use the picker." });
      return;
    }

    try {
      const entries: Array<{ name: string; kind: string; size?: number }> = [];
      for await (const [name, entry] of (handle as any).entries()) {
        const item: { name: string; kind: string; size?: number } = {
          name,
          kind: entry.kind,
        };
        if (entry.kind === "file") {
          try {
            const file = await entry.getFile();
            item.size = file.size;
          } catch { /* permission denied */ }
        }
        entries.push(item);
      }

      entries.sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

      const meta = {
        name: handle.name,
        count: entries.length,
        files: entries.filter(e => e.kind === "file").length,
        folders: entries.filter(e => e.kind === "directory").length,
      };
      ctx.setOutput("entries", entries);
      ctx.setOutput("meta", meta);
    } catch (err) {
      ctx.setOutput("entries", []);
      ctx.setOutput("meta", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },
};

export async function pickFolder(nodeId: string): Promise<{ name: string } | null> {
  if (!("showDirectoryPicker" in window)) return null;
  try {
    const handle = await (window as any).showDirectoryPicker();
    dirHandleStore.set(nodeId, handle);
    return { name: handle.name };
  } catch {
    return null;
  }
}

// ── Terminal Node ────────────────────────────────────────────────────────────

const terminalNodeDef: NodeDef = {
  type: "sys:terminal",
  subsystem: "system",
  description: "Code execution REPL",
  trigger: "manual",
  inputs: [
    { name: "in", type: "any", optional: true },
    { name: "stdin", type: "text", optional: true },
  ],
  outputs: [
    { name: "stdout", type: "text" },
    { name: "result", type: "data" },
    { name: "history", type: "text" },
  ],
  capabilities: [{ subsystem: "system", action: "execute" }],
  execution: { mode: "exclusive", concurrencyKey: "system:terminal" },
  async execute(ctx: ExecContext) {
    const config = ctx.getConfig();
    const upstream = ctx.getInput("in");
    const stdin = ctx.getInput("stdin") ?? upstream;
    const { history, stdout, result } = await executeTerminal(ctx.nodeId, config, stdin);

    ctx.setOutput("history", JSON.stringify(history));
    ctx.setOutput("stdout", stdout);
    ctx.setOutput("result", result);
  },
};

// ── Notebook Node ────────────────────────────────────────────────────────────

const notebookNodeDef: NodeDef = {
  type: "sys:notebook",
  subsystem: "system",
  description: "Multi-cell polyglot notebook",
  trigger: "manual",
  inputs: [
    { name: "in", type: "any", optional: true },
    { name: "data", type: "data", optional: true },
  ],
  outputs: [
    { name: "all", type: "data" },
    { name: "cells", type: "text" },
  ],
  capabilities: [{ subsystem: "system", action: "execute" }],
  execution: { mode: "exclusive", concurrencyKey: "system:notebook" },
  async execute(ctx: ExecContext) {
    // Notebook execution is driven by the UI (run button / Shift+Enter),
    // NOT by the runtime scheduler. We only pass through current cells
    // so ports stay wired.
    const config = ctx.getConfig();
    const cellsRaw = typeof config.cells === "string" ? config.cells : "[]";
    ctx.setOutput("cells", cellsRaw);

    try {
      const cells = JSON.parse(cellsRaw) as Array<{ id: string; type: string; output?: string }>;
      const allOutputs: Record<string, unknown> = {};
      for (let i = 0; i < cells.length; i++) {
        if (cells[i].type === "code" && cells[i].output) {
          try {
            const parsed = JSON.parse(cells[i].output!);
            if (typeof parsed === "object" && parsed !== null) Object.assign(allOutputs, parsed);
            else allOutputs[`cell${i}`] = parsed;
          } catch { allOutputs[`cell${i}`] = cells[i].output; }
          ctx.setOutput(`cell:${i}`, allOutputs[`cell${i}`] ?? cells[i].output);
        }
      }
      ctx.setOutput("all", allOutputs);
    } catch {
      ctx.setOutput("all", {});
    }
  },
};

// ── Clipboard Nodes ─────────────────────────────────────────────────────────

const clipboardReadNodeDef: NodeDef = {
  type: "sys:clipboard-read",
  subsystem: "system",
  description: "Read system clipboard",
  trigger: "manual",
  inputs: [{ name: "in", type: "any", optional: true }],
  outputs: [
    { name: "text", type: "text" },
    { name: "items", type: "array" },
  ],
  capabilities: [{ subsystem: "system", action: "read" }],
  async execute(ctx: ExecContext) {
    try {
      const text = await navigator.clipboard.readText();
      ctx.setOutput("text", text);

      const items: Array<{ type: string; size: number }> = [];
      try {
        const clipItems = await navigator.clipboard.read();
        for (const item of clipItems) {
          for (const type of item.types) {
            const blob = await item.getType(type);
            items.push({ type, size: blob.size });
          }
        }
      } catch { /* clipboard.read() may not be available */ }

      ctx.setOutput("items", items);
    } catch {
      ctx.setOutput("text", "");
      ctx.setOutput("items", [{ type: "error", size: 0 }]);
    }
  },
};

const clipboardWriteNodeDef: NodeDef = {
  type: "sys:clipboard-write",
  subsystem: "system",
  description: "Write to system clipboard",
  trigger: "manual",
  inputs: [
    { name: "in", type: "any", optional: true },
    { name: "text", type: "text", optional: true },
  ],
  outputs: [
    { name: "ok", type: "boolean" },
  ],
  capabilities: [{ subsystem: "system", action: "write" }],
  async execute(ctx: ExecContext) {
    const upstream = ctx.getInput("in") as string | undefined;
    const text = (ctx.getInput("text") as string) || upstream || "";
    try {
      await navigator.clipboard.writeText(text);
      ctx.setOutput("ok", true);
    } catch {
      ctx.setOutput("ok", false);
    }
  },
};

// ── Env Node ─────────────────────────────────────────────────────────────────

const envNodeDef: NodeDef = {
  type: "sys:env",
  subsystem: "system",
  description: "Browser environment info",
  trigger: "once",
  inputs: [{ name: "in", type: "any", optional: true }],
  outputs: [
    { name: "vars", type: "data" },
  ],
  execute(ctx: ExecContext) {
    const vars: Record<string, unknown> = {
      userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "unknown",
      language: typeof navigator !== "undefined" ? navigator.language : "en",
      languages: typeof navigator !== "undefined" ? [...navigator.languages] : ["en"],
      platform: typeof navigator !== "undefined" ? navigator.platform : "unknown",
      cookieEnabled: typeof navigator !== "undefined" ? navigator.cookieEnabled : false,
      onLine: typeof navigator !== "undefined" ? navigator.onLine : true,
      hardwareConcurrency: typeof navigator !== "undefined" ? navigator.hardwareConcurrency : 1,
      maxTouchPoints: typeof navigator !== "undefined" ? navigator.maxTouchPoints : 0,
      url: typeof location !== "undefined" ? location.href : "",
      origin: typeof location !== "undefined" ? location.origin : "",
      pathname: typeof location !== "undefined" ? location.pathname : "",
      screenWidth: typeof screen !== "undefined" ? screen.width : 0,
      screenHeight: typeof screen !== "undefined" ? screen.height : 0,
      colorDepth: typeof screen !== "undefined" ? screen.colorDepth : 0,
      pixelRatio: typeof devicePixelRatio !== "undefined" ? devicePixelRatio : 1,
      timestamp: Date.now(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    };
    ctx.setOutput("vars", vars);
  },
};

// ── System Subsystem ─────────────────────────────────────────────────────────

export const systemSubsystem: Subsystem = {
  id: "system",
  name: "System",
  nodeTypes: [
    fileOpenNodeDef,
    fileWriteNodeDef,
    folderNodeDef,
    clipboardReadNodeDef,
    clipboardWriteNodeDef,
    terminalNodeDef,
    notebookNodeDef,
    envNodeDef,
  ],
  init(_runtime) {
    // System subsystem is ready immediately
  },
};

// Re-export execution functions for direct use by canvas and tests
export { executeTerminal, executeNotebook, executeCode, evalJS, resetTerminalSession } from "./execution";
export type { TerminalHistoryEntry, NotebookCell } from "./execution";
