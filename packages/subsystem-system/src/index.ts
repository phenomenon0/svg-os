/**
 * System Subsystem — real OS primitives via browser APIs.
 *
 * Files/Folders: File System Access API (showOpenFilePicker, showDirectoryPicker)
 * Disks: navigator.storage.estimate()
 * Processes: running node executions tracked by the runtime
 * Terminal: code execution via canvas code-runner
 * Notebook: multi-cell reactive execution
 */

import type { Subsystem, NodeDef, ExecContext, NodeId } from "@svg-os/core";

// ── File Open Node ───────────────────────────────────────────────────────────
// Opens a real file from the user's filesystem via File System Access API.
// The file handle is stored in config; content is read on each execution.

const fileHandleStore = new Map<string, FileSystemFileHandle>();

const fileOpenNodeDef: NodeDef = {
  type: "sys:file-open",
  subsystem: "system",
  inputs: [],
  outputs: [
    { name: "content", type: "text" },
    { name: "meta", type: "data" },
  ],
  capabilities: [{ subsystem: "system", action: "fs", scope: "read" }],
  async execute(ctx: ExecContext, nodeId: NodeId) {
    const handle = fileHandleStore.get(nodeId);
    if (!handle) {
      ctx.setOutput(nodeId, "content", "");
      ctx.setOutput(nodeId, "meta", { error: "No file selected. Use the picker." });
      return;
    }

    try {
      const file = await handle.getFile();
      const text = await file.text();
      ctx.setOutput(nodeId, "content", text);
      ctx.setOutput(nodeId, "meta", {
        name: file.name,
        size: file.size,
        type: file.type || "text/plain",
        lastModified: file.lastModified,
      });
    } catch (err) {
      ctx.setOutput(nodeId, "content", "");
      ctx.setOutput(nodeId, "meta", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },
};

// Callable from canvas UI to trigger the native file picker
export async function pickFile(nodeId: string): Promise<{ name: string } | null> {
  if (!("showOpenFilePicker" in window)) return null;
  try {
    const [handle] = await (window as any).showOpenFilePicker({
      multiple: false,
    });
    fileHandleStore.set(nodeId, handle);
    return { name: handle.name };
  } catch {
    return null; // user cancelled
  }
}

// ── File Write Node ──────────────────────────────────────────────────────────
// Writes content to a file via File System Access API (Save As dialog).

const fileWriteNodeDef: NodeDef = {
  type: "sys:file-write",
  subsystem: "system",
  inputs: [
    { name: "content", type: "text" },
    { name: "filename", type: "text", optional: true },
  ],
  outputs: [
    { name: "ok", type: "boolean" },
    { name: "meta", type: "data" },
  ],
  capabilities: [{ subsystem: "system", action: "fs", scope: "write" }],
  async execute(ctx: ExecContext, nodeId: NodeId) {
    const content = (ctx.getInput(nodeId, "content") as string) || "";
    const config = ctx.getConfig(nodeId);
    const filename = (ctx.getInput(nodeId, "filename") as string) || (config.filename as string) || "untitled.txt";

    if (!("showSaveFilePicker" in window)) {
      // Fallback: download via blob
      try {
        const blob = new Blob([content], { type: "text/plain" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
        ctx.setOutput(nodeId, "ok", true);
        ctx.setOutput(nodeId, "meta", { method: "download", filename });
      } catch (err) {
        ctx.setOutput(nodeId, "ok", false);
        ctx.setOutput(nodeId, "meta", { error: err instanceof Error ? err.message : String(err) });
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
      ctx.setOutput(nodeId, "ok", true);
      ctx.setOutput(nodeId, "meta", { name: handle.name, method: "filesystem" });
    } catch (err) {
      ctx.setOutput(nodeId, "ok", false);
      ctx.setOutput(nodeId, "meta", { error: err instanceof Error ? err.message : String(err) });
    }
  },
};

// ── Folder Node ──────────────────────────────────────────────────────────────
// Opens a directory and lists its contents via File System Access API.

const dirHandleStore = new Map<string, FileSystemDirectoryHandle>();

const folderNodeDef: NodeDef = {
  type: "sys:folder",
  subsystem: "system",
  inputs: [],
  outputs: [
    { name: "entries", type: "array" },
    { name: "meta", type: "data" },
  ],
  capabilities: [{ subsystem: "system", action: "fs", scope: "read" }],
  async execute(ctx: ExecContext, nodeId: NodeId) {
    const handle = dirHandleStore.get(nodeId);
    if (!handle) {
      ctx.setOutput(nodeId, "entries", []);
      ctx.setOutput(nodeId, "meta", { error: "No folder selected. Use the picker." });
      return;
    }

    try {
      const entries: Array<{ name: string; kind: string; size?: number }> = [];
      for await (const [name, entry] of (handle as any).entries()) {
        const item: { name: string; kind: string; size?: number } = {
          name,
          kind: entry.kind, // "file" or "directory"
        };
        if (entry.kind === "file") {
          try {
            const file = await entry.getFile();
            item.size = file.size;
          } catch { /* permission denied */ }
        }
        entries.push(item);
      }

      // Sort: directories first, then files
      entries.sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

      ctx.setOutput(nodeId, "entries", entries);
      ctx.setOutput(nodeId, "meta", {
        name: handle.name,
        count: entries.length,
        files: entries.filter(e => e.kind === "file").length,
        folders: entries.filter(e => e.kind === "directory").length,
      });
    } catch (err) {
      ctx.setOutput(nodeId, "entries", []);
      ctx.setOutput(nodeId, "meta", {
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

// ── Disk Node ────────────────────────────────────────────────────────────────
// Shows storage usage via navigator.storage API.

const diskNodeDef: NodeDef = {
  type: "sys:disk",
  subsystem: "system",
  inputs: [],
  outputs: [
    { name: "info", type: "data" },
  ],
  async execute(ctx: ExecContext, nodeId: NodeId) {
    try {
      if (navigator.storage && navigator.storage.estimate) {
        const estimate = await navigator.storage.estimate();
        const used = estimate.usage || 0;
        const total = estimate.quota || 0;
        ctx.setOutput(nodeId, "info", {
          used,
          total,
          free: total - used,
          usedMB: Math.round(used / 1024 / 1024),
          totalMB: Math.round(total / 1024 / 1024),
          freeMB: Math.round((total - used) / 1024 / 1024),
          percent: total > 0 ? Math.round((used / total) * 100) : 0,
          persisted: await navigator.storage.persisted?.() || false,
        });
      } else {
        ctx.setOutput(nodeId, "info", { error: "Storage API not available" });
      }
    } catch (err) {
      ctx.setOutput(nodeId, "info", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },
};

// ── Process Node ─────────────────────────────────────────────────────────────
// Lists running "processes" — currently executing nodes in the runtime graph.
// Also exposes performance metrics.

const processNodeDef: NodeDef = {
  type: "sys:processes",
  subsystem: "system",
  inputs: [],
  outputs: [
    { name: "list", type: "array" },
    { name: "stats", type: "data" },
  ],
  execute(ctx: ExecContext, nodeId: NodeId) {
    // Performance metrics
    const perf = typeof performance !== "undefined" ? performance : null;
    const memory = (perf as any)?.memory;

    ctx.setOutput(nodeId, "stats", {
      uptime: perf ? Math.round(perf.now() / 1000) : 0,
      heapUsedMB: memory ? Math.round(memory.usedJSHeapSize / 1024 / 1024) : null,
      heapTotalMB: memory ? Math.round(memory.totalJSHeapSize / 1024 / 1024) : null,
      heapLimitMB: memory ? Math.round(memory.jsHeapSizeLimit / 1024 / 1024) : null,
      hardwareConcurrency: typeof navigator !== "undefined" ? navigator.hardwareConcurrency : null,
      userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "unknown",
      timestamp: Date.now(),
    });

    // The "process list" is a snapshot of the caller — in future,
    // this will list all Runtime graph nodes with their execution status.
    // For now, output a placeholder.
    ctx.setOutput(nodeId, "list", []);
  },
};

// ── Terminal Node ────────────────────────────────────────────────────────────

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

    try {
      const entries = JSON.parse(history) as Array<{ type: string; text: string }>;
      const lastInput = [...entries].reverse().find(e => e.type === "input");
      if (lastInput) {
        ctx.setOutput(nodeId, "stdout", lastInput.text);
        ctx.setOutput(nodeId, "result", { command: lastInput.text, mode: config.mode || "js" });
      }
    } catch { /* */ }
  },
};

// ── Notebook Node ────────────────────────────────────────────────────────────

const notebookNodeDef: NodeDef = {
  type: "sys:notebook",
  subsystem: "system",
  inputs: [{ name: "data", type: "data", optional: true }],
  outputs: [{ name: "all", type: "data" }],
  capabilities: [{ subsystem: "system", action: "execute" }],
  execute(ctx: ExecContext, nodeId: NodeId) {
    const config = ctx.getConfig(nodeId);
    const cellsJson = (config.cells as string) || "[]";

    try {
      const cells = JSON.parse(cellsJson) as Array<{
        id: string; type: string; lang: string; output: string;
      }>;

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
          ctx.setOutput(nodeId, `cell:${i}`, allOutputs[`cell${i}`] || cell.output);
        }
      }

      ctx.setOutput(nodeId, "all", allOutputs);
    } catch { /* */ }
  },
};

// ── Clipboard Node ───────────────────────────────────────────────────────────
// Read/write the system clipboard.

const clipboardReadNodeDef: NodeDef = {
  type: "sys:clipboard-read",
  subsystem: "system",
  inputs: [],
  outputs: [
    { name: "text", type: "text" },
    { name: "items", type: "array" },
  ],
  capabilities: [{ subsystem: "system", action: "read" }],
  async execute(ctx: ExecContext, nodeId: NodeId) {
    try {
      const text = await navigator.clipboard.readText();
      ctx.setOutput(nodeId, "text", text);

      // Try to read all clipboard items (images, etc.)
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

      ctx.setOutput(nodeId, "items", items);
    } catch (err) {
      ctx.setOutput(nodeId, "text", "");
      ctx.setOutput(nodeId, "items", [{ type: "error", size: 0 }]);
    }
  },
};

const clipboardWriteNodeDef: NodeDef = {
  type: "sys:clipboard-write",
  subsystem: "system",
  inputs: [{ name: "text", type: "text" }],
  outputs: [{ name: "ok", type: "boolean" }],
  capabilities: [{ subsystem: "system", action: "write" }],
  async execute(ctx: ExecContext, nodeId: NodeId) {
    const text = (ctx.getInput(nodeId, "text") as string) || "";
    try {
      await navigator.clipboard.writeText(text);
      ctx.setOutput(nodeId, "ok", true);
    } catch {
      ctx.setOutput(nodeId, "ok", false);
    }
  },
};

// ── Screen Capture Node ──────────────────────────────────────────────────────
// Captures a screenshot via getDisplayMedia API.

const screenCaptureStore = new Map<string, string>(); // nodeId -> base64 data URL

const screenCaptureNodeDef: NodeDef = {
  type: "sys:screen-capture",
  subsystem: "system",
  inputs: [],
  outputs: [
    { name: "image", type: "image" },
    { name: "meta", type: "data" },
  ],
  capabilities: [{ subsystem: "system", action: "read" }],
  async execute(ctx: ExecContext, nodeId: NodeId) {
    const existing = screenCaptureStore.get(nodeId);
    if (existing) {
      ctx.setOutput(nodeId, "image", existing);
      ctx.setOutput(nodeId, "meta", { status: "cached" });
      return;
    }
    ctx.setOutput(nodeId, "image", "");
    ctx.setOutput(nodeId, "meta", { status: "Use captureScreen() to take a screenshot" });
  },
};

export async function captureScreen(nodeId: string): Promise<string | null> {
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
    const track = stream.getVideoTracks()[0];
    const imageCapture = new (window as any).ImageCapture(track);
    const bitmap = await imageCapture.grabFrame();
    track.stop();

    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx2d = canvas.getContext("2d")!;
    ctx2d.drawImage(bitmap, 0, 0);
    const dataUrl = canvas.toDataURL("image/png");
    screenCaptureStore.set(nodeId, dataUrl);
    return dataUrl;
  } catch {
    return null;
  }
}

// ── Notification Node ────────────────────────────────────────────────────────
// Send native OS notifications.

const notifyNodeDef: NodeDef = {
  type: "sys:notify",
  subsystem: "system",
  inputs: [
    { name: "title", type: "text" },
    { name: "body", type: "text", optional: true },
  ],
  outputs: [{ name: "ok", type: "boolean" }],
  async execute(ctx: ExecContext, nodeId: NodeId) {
    const config = ctx.getConfig(nodeId);
    const title = (ctx.getInput(nodeId, "title") as string) || (config.title as string) || "SVG OS";
    const body = (ctx.getInput(nodeId, "body") as string) || (config.body as string) || "";

    try {
      if (Notification.permission === "granted") {
        new Notification(title, { body });
        ctx.setOutput(nodeId, "ok", true);
      } else if (Notification.permission !== "denied") {
        const perm = await Notification.requestPermission();
        if (perm === "granted") {
          new Notification(title, { body });
          ctx.setOutput(nodeId, "ok", true);
        } else {
          ctx.setOutput(nodeId, "ok", false);
        }
      } else {
        ctx.setOutput(nodeId, "ok", false);
      }
    } catch {
      ctx.setOutput(nodeId, "ok", false);
    }
  },
};

// ── Network Info Node ────────────────────────────────────────────────────────
// Exposes connection type, downlink speed, etc.

const networkInfoNodeDef: NodeDef = {
  type: "sys:network",
  subsystem: "system",
  inputs: [],
  outputs: [{ name: "info", type: "data" }],
  execute(ctx: ExecContext, nodeId: NodeId) {
    const conn = (navigator as any).connection;
    ctx.setOutput(nodeId, "info", {
      online: navigator.onLine,
      type: conn?.effectiveType || "unknown",
      downlink: conn?.downlink || null,
      rtt: conn?.rtt || null,
      saveData: conn?.saveData || false,
    });
  },
};

// ── Geolocation Node ─────────────────────────────────────────────────────────

const geoStore = new Map<string, { lat: number; lng: number }>();

const geoNodeDef: NodeDef = {
  type: "sys:geolocation",
  subsystem: "system",
  inputs: [],
  outputs: [{ name: "location", type: "data" }],
  capabilities: [{ subsystem: "system", action: "read" }],
  async execute(ctx: ExecContext, nodeId: NodeId) {
    const cached = geoStore.get(nodeId);
    if (cached) {
      ctx.setOutput(nodeId, "location", cached);
      return;
    }

    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 10000 });
      });
      const loc = {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
        altitude: pos.coords.altitude,
        speed: pos.coords.speed,
        timestamp: pos.timestamp,
      };
      geoStore.set(nodeId, loc as any);
      ctx.setOutput(nodeId, "location", loc);
    } catch (err) {
      ctx.setOutput(nodeId, "location", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },
};

// ── Env Node ─────────────────────────────────────────────────────────────────

const envNodeDef: NodeDef = {
  type: "sys:env",
  subsystem: "system",
  inputs: [],
  outputs: [{ name: "vars", type: "data" }],
  execute(ctx: ExecContext, nodeId: NodeId) {
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
    ctx.setOutput(nodeId, "vars", vars);
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
    diskNodeDef,
    processNodeDef,
    clipboardReadNodeDef,
    clipboardWriteNodeDef,
    screenCaptureNodeDef,
    notifyNodeDef,
    networkInfoNodeDef,
    geoNodeDef,
    terminalNodeDef,
    notebookNodeDef,
    envNodeDef,
  ],
  init(_runtime) {
    // System subsystem is ready immediately
  },
};

// captureScreen is also exported above via its declaration
