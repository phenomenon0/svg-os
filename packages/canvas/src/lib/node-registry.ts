/**
 * node-registry.ts — Shared node type registry.
 *
 * Extracted from NodePalette and CommandPalette to avoid duplication.
 * Maps between runtime node types, canvas shape types, and default props.
 */

import { getModel } from "./claude-api";

// ── Node descriptions ────────────────────────────────────────────────────────

export const NODE_DESCRIPTIONS: Record<string, string> = {
  "sys:file-open": "Open a file from disk",
  "sys:file-write": "Save content to a file",
  "sys:folder": "Browse a directory",
  "sys:disk": "Storage usage info",
  "sys:processes": "Runtime metrics & memory",
  "sys:clipboard-read": "Read from clipboard",
  "sys:clipboard-write": "Write to clipboard",
  "sys:screen-capture": "Take a screenshot",
  "sys:notify": "Send a notification",
  "sys:network": "Network connection info",
  "sys:geolocation": "GPS location",
  "sys:terminal": "Code execution sandbox",
  "sys:notebook": "Multi-cell notebook",
  "sys:env": "Environment variables",
  "data:json": "Static JSON source",
  "data:table": "Tabular data editor",
  "data:transform": "Expression transform",
  "data:filter": "Filter an array",
  "data:merge": "Merge two objects",
  "data:fetch": "HTTP fetch",
  "data:ai": "Claude AI completion",
  "view:svg-template": "Rendered SVG template",
  "view:note": "Markdown editor",
  "view:media": "Image/video/audio player",
  "view:webview": "Web browser iframe",
  "view:metric": "Single value display",
  "view:chart": "Data chart",
};

// ── Shape mapping ────────────────────────────────────────────────────────────

export const NODE_TO_SHAPE: Record<string, string> = {
  "sys:terminal": "terminal-node",
  "sys:notebook": "notebook-node",
  "data:json": "data-node",
  "data:table": "table-node",
  "data:transform": "transform-node",
  "data:ai": "ai-node",
  "view:note": "note-node",
  "view:media": "media-node",
  "view:svg-template": "view-node",
  "view:webview": "web-view",
};

// ── Subsystem colors ─────────────────────────────────────────────────────────

export function subsystemColor(type: string): string {
  // Import C lazily to avoid circular deps at module load
  const C = { green: "#7eb59d", blue: "#6a9fcf", accent: "#e6a756", muted: "#a09a90" };
  if (type.startsWith("sys:")) return C.green;
  if (type.startsWith("data:")) return C.blue;
  if (type.startsWith("view:")) return C.accent;
  return C.muted;
}

// ── Default props per shape type ─────────────────────────────────────────────

export function defaultPropsForShape(shapeType: string): Record<string, unknown> {
  switch (shapeType) {
    case "terminal-node":
      return {
        w: 400, h: 280, label: "Terminal", mode: "js",
        history: JSON.stringify([
          { type: "output", text: "SVG OS Terminal \u2014 JavaScript sandbox" },
          { type: "output", text: "Type expressions, see results. Try: 1 + 1" },
        ]),
        pendingCommand: "",
        runNonce: 0,
        clearNonce: 0,
      };
    case "notebook-node":
      return {
        w: 400, h: 320, label: "Notebook",
        cells: JSON.stringify([{ id: "c1", type: "code", lang: "js", source: "", output: "" }]),
      };
    case "data-node":
      return { w: 300, h: 200, dataJson: '{\n  "name": "Example",\n  "score": 95\n}', label: "Data" };
    case "table-node":
      return { w: 320, h: 240, label: "Table", dataJson: "[]", selectedRow: -1, outputMode: "all" };
    case "transform-node":
      return { w: 180, h: 48, expression: "$.value", label: "Transform" };
    case "ai-node":
      return { w: 400, h: 320, label: "AI", prompt: "", response: "", model: getModel(), status: "idle", errorMessage: "", runNonce: 0 };
    case "note-node":
      return { w: 320, h: 240, label: "Note", content: "", mode: "edit" };
    case "media-node":
      return { w: 320, h: 260, label: "Media", mediaType: "none", src: "", filename: "", mimeType: "", fileSize: 0 };
    case "web-view":
      return { w: 480, h: 360, url: "https://femiadeniran.com", label: "WebView", mode: "url", htmlContent: "" };
    default:
      return { w: 300, h: 200, label: "Node" };
  }
}

// ── Placeable node types (ones that have shape implementations) ──────────────

export const PLACEABLE_NODE_TYPES = [
  { nodeType: "view:note", label: "Note", color: "#e6a756" },
  { nodeType: "data:table", label: "Table", color: "#6a9fcf" },
  { nodeType: "sys:terminal", label: "Terminal", color: "#7eb59d" },
  { nodeType: "data:json", label: "Data", color: "#7eb59d" },
  { nodeType: "sys:notebook", label: "Notebook", color: "#a78bca" },
  { nodeType: "view:webview", label: "WebView", color: "#7abfb8" },
  { nodeType: "data:ai", label: "AI", color: "#6a9fcf" },
  { nodeType: "data:transform", label: "Transform", color: "#a78bca" },
];
