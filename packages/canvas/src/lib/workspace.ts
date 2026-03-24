/**
 * workspace.ts — Types, CRUD, and preset factory definitions for workspaces.
 *
 * Each workspace is an isolated environment with its own tldraw shapes,
 * runtime graph, and optional tiled layout.
 */

import type { Editor } from "tldraw";
import type { Runtime } from "@svg-os/core";
import { getModel } from "./claude-api";

// ── Types ────────────────────────────────────────────────────────────────────

export type PresetId =
  | "blank"
  | "claude-dev"
  | "musician"
  | "painter"
  | "hacker"
  | "programmer"
  | "designer";

export interface WorkspaceDescriptor {
  id: string;
  name: string;
  preset: PresetId;
  mode: "canvas" | "tiled";
  tiledLayout?: TiledLayout;
  createdAt: number;
  updatedAt: number;
}

export interface WorkspaceSnapshot {
  descriptor: WorkspaceDescriptor;
  tldrawSnapshot: unknown; // StoreSnapshot<TLRecord>
  runtimeSnapshot: unknown; // GraphSnapshot
}

export type TiledLayout = {
  direction: "horizontal" | "vertical";
  children: TiledPanelNode[];
};

export type TiledPanelNode =
  | {
      type: "split";
      direction: "horizontal" | "vertical";
      children: TiledPanelNode[];
      ratio?: number;
    }
  | { type: "leaf"; shapeId: string; ratio?: number };

// ── Storage keys ─────────────────────────────────────────────────────────────

const WORKSPACES_KEY = "svgos:workspaces";
const ACTIVE_KEY = "svgos:active-workspace";

// ── CRUD ─────────────────────────────────────────────────────────────────────

export function listWorkspaces(): WorkspaceSnapshot[] {
  try {
    return JSON.parse(localStorage.getItem(WORKSPACES_KEY) || "[]");
  } catch {
    return [];
  }
}

export function loadWorkspace(id: string): WorkspaceSnapshot | undefined {
  return listWorkspaces().find((ws) => ws.descriptor.id === id);
}

export function saveWorkspace(snapshot: WorkspaceSnapshot): void {
  const all = listWorkspaces();
  const idx = all.findIndex((ws) => ws.descriptor.id === snapshot.descriptor.id);
  if (idx >= 0) {
    all[idx] = snapshot;
  } else {
    all.push(snapshot);
  }
  localStorage.setItem(WORKSPACES_KEY, JSON.stringify(all));
}

export function deleteWorkspace(id: string): void {
  const all = listWorkspaces().filter((ws) => ws.descriptor.id !== id);
  localStorage.setItem(WORKSPACES_KEY, JSON.stringify(all));
  if (getActiveWorkspaceId() === id) {
    localStorage.removeItem(ACTIVE_KEY);
  }
}

export function getActiveWorkspaceId(): string | null {
  return localStorage.getItem(ACTIVE_KEY);
}

export function setActiveWorkspaceId(id: string | null): void {
  if (id) {
    localStorage.setItem(ACTIVE_KEY, id);
  } else {
    localStorage.removeItem(ACTIVE_KEY);
  }
}

// ── Snapshot helpers ─────────────────────────────────────────────────────────

export function captureWorkspace(
  editor: Editor,
  _runtime: Runtime,
  descriptor: WorkspaceDescriptor,
): WorkspaceSnapshot {
  return {
    descriptor: { ...descriptor, updatedAt: Date.now() },
    tldrawSnapshot: editor.store.getStoreSnapshot(),
    runtimeSnapshot: null, // Runtime doesn't expose save(); we rebuild from shapes
  };
}

export function restoreWorkspace(
  editor: Editor,
  _runtime: Runtime,
  snapshot: WorkspaceSnapshot,
): void {
  if (snapshot.tldrawSnapshot) {
    editor.store.loadStoreSnapshot(snapshot.tldrawSnapshot as never);
  }
}

// ── Preset metadata ──────────────────────────────────────────────────────────

export interface PresetInfo {
  id: PresetId;
  name: string;
  description: string;
  icon: string; // single character
  color: string;
}

export const PRESETS: PresetInfo[] = [
  {
    id: "claude-dev",
    name: "Claude Dev",
    description: "AI chat + preview + scratchpad",
    icon: "C",
    color: "#8fa4c9",
  },
  {
    id: "musician",
    name: "Musician",
    description: "Record + piano + lyrics",
    icon: "M",
    color: "#cf7a9a",
  },
  {
    id: "painter",
    name: "Painter",
    description: "Drawing + reference + music",
    icon: "P",
    color: "#e6a756",
  },
  {
    id: "hacker",
    name: "Hacker",
    description: "Data + notebook + terminal + cheatsheet",
    icon: "H",
    color: "#7eb59d",
  },
  {
    id: "programmer",
    name: "Programmer",
    description: "Claude + notes + docs",
    icon: "D",
    color: "#a78bca",
  },
  {
    id: "designer",
    name: "Designer",
    description: "Desktop + iPhone + design tokens",
    icon: "S",
    color: "#7abfb8",
  },
  {
    id: "blank",
    name: "Blank",
    description: "Empty infinite canvas",
    icon: "B",
    color: "#6b6660",
  },
];

// ── Shape ID generator (deterministic for layout wiring) ─────────────────────

let shapeCounter = 0;
function nextShapeId(): string {
  return `shape:ws_${Date.now()}_${shapeCounter++}` as string;
}

// ── Preset factories ─────────────────────────────────────────────────────────

interface ShapeSpec {
  id: string;
  type: string;
  x: number;
  y: number;
  props: Record<string, unknown>;
}

interface PresetResult {
  shapes: ShapeSpec[];
  layout: TiledLayout;
  arrows?: Array<{ from: string; to: string }>;
}

function makeLeaf(shapeId: string, ratio?: number): TiledPanelNode {
  return { type: "leaf" as const, shapeId, ratio };
}

function makeSplit(
  direction: "horizontal" | "vertical",
  children: TiledPanelNode[],
  ratio?: number,
): TiledPanelNode {
  return { type: "split" as const, direction, children, ratio };
}

const DESIGNER_HTML = `<!DOCTYPE html>
<html><head><style>
* { margin:0; box-sizing:border-box; font-family: Inter, system-ui, sans-serif; }
body { background: #1a1815; color: #e8e4df; padding: 24px; }
.card { background: #242220; border-radius: 12px; padding: 24px; border: 1px solid #3a3632; margin-bottom: 16px; }
h1 { font-size: 24px; margin-bottom: 8px; }
p { color: #a09a90; font-size: 14px; line-height: 1.6; }
.btn { display: inline-block; background: #e6a756; color: #1a1815; padding: 8px 20px; border-radius: 6px; font-weight: 600; font-size: 13px; margin-top: 12px; }
</style></head><body>
<div class="card">
  <h1>App Name</h1>
  <p>Edit the design tokens table to update this view. Connect the table output to this webview input.</p>
  <span class="btn">Get Started</span>
</div>
<div class="card">
  <p>This is a responsive layout. The desktop and iPhone views share the same HTML.</p>
</div>
</body></html>`;

const DESIGNER_IPHONE_HTML = `<!DOCTYPE html>
<html><head><style>
* { margin:0; box-sizing:border-box; font-family: Inter, system-ui, sans-serif; }
body { background: #1a1815; color: #e8e4df; display:flex; justify-content:center; padding-top:20px; }
.phone { width:375px; min-height:600px; background:#1a1815; border-radius:40px; border:3px solid #3a3632; padding:48px 16px 24px; position:relative; }
.phone::before { content:''; position:absolute; top:12px; left:50%; transform:translateX(-50%); width:80px; height:4px; border-radius:2px; background:#3a3632; }
.card { background: #242220; border-radius: 12px; padding: 20px; border: 1px solid #3a3632; margin-bottom: 12px; }
h1 { font-size: 20px; margin-bottom: 6px; }
p { color: #a09a90; font-size: 13px; line-height: 1.5; }
.btn { display: inline-block; background: #e6a756; color: #1a1815; padding: 8px 20px; border-radius: 6px; font-weight: 600; font-size: 13px; margin-top: 10px; }
</style></head><body>
<div class="phone">
  <div class="card">
    <h1>App Name</h1>
    <p>Mobile view. Same data source, responsive layout.</p>
    <span class="btn">Get Started</span>
  </div>
  <div class="card">
    <p>Connected to the design tokens table.</p>
  </div>
</div>
</body></html>`;

function buildClaudeDevPreset(): PresetResult {
  const aiId = nextShapeId();
  const webId = nextShapeId();
  const noteId = nextShapeId();

  return {
    shapes: [
      {
        id: aiId,
        type: "ai-node",
        x: 0,
        y: 0,
        props: {
          w: 600,
          h: 800,
          label: "Claude",
          prompt: "",
          response: "",
          model: getModel(),
          status: "idle",
          errorMessage: "",
          runNonce: 0,
        },
      },
      {
        id: webId,
        type: "web-view",
        x: 620,
        y: 0,
        props: {
          w: 500,
          h: 390,
          url: "about:blank",
          label: "Preview",
          mode: "url",
          htmlContent: "",
        },
      },
      {
        id: noteId,
        type: "note-node",
        x: 620,
        y: 410,
        props: {
          w: 500,
          h: 390,
          label: "Scratchpad",
          content:
            "# Scratchpad\n\nComment here as we go.\n\n---\n\n## Plans\n\n\n## Documents\n\n",
          mode: "edit",
        },
      },
    ],
    layout: {
      direction: "horizontal",
      children: [
        makeLeaf(aiId, 0.5),
        makeSplit("vertical", [makeLeaf(webId, 0.5), makeLeaf(noteId, 0.5)], 0.5),
      ],
    },
  };
}

function buildMusicianPreset(): PresetResult {
  const recordId = nextShapeId();
  const pianoId = nextShapeId();
  const lyricsId = nextShapeId();

  return {
    shapes: [
      {
        id: recordId,
        type: "web-view",
        x: 0,
        y: 0,
        props: {
          w: 500,
          h: 800,
          url: "https://femiadeniran.com/rawcut",
          label: "Record",
          mode: "url",
          htmlContent: "",
        },
      },
      {
        id: pianoId,
        type: "web-view",
        x: 520,
        y: 0,
        props: {
          w: 500,
          h: 390,
          url: "https://www.onlinepianist.com/virtual-piano",
          label: "Piano",
          mode: "url",
          htmlContent: "",
        },
      },
      {
        id: lyricsId,
        type: "note-node",
        x: 520,
        y: 410,
        props: {
          w: 500,
          h: 390,
          label: "Lyrics",
          content: "# Lyrics\n\nVerse 1:\n\n\nChorus:\n\n\nVerse 2:\n\n\nBridge:\n\n",
          mode: "edit",
        },
      },
    ],
    layout: {
      direction: "horizontal",
      children: [
        makeLeaf(recordId, 0.5),
        makeSplit("vertical", [makeLeaf(pianoId, 0.5), makeLeaf(lyricsId, 0.5)], 0.5),
      ],
    },
  };
}

function buildPainterPreset(): PresetResult {
  const canvasId = nextShapeId();
  const refId = nextShapeId();
  const musicId = nextShapeId();

  return {
    shapes: [
      {
        id: canvasId,
        type: "web-view",
        x: 0,
        y: 0,
        props: {
          w: 600,
          h: 800,
          url: "https://www.tldraw.com",
          label: "Canvas",
          mode: "url",
          htmlContent: "",
        },
      },
      {
        id: refId,
        type: "web-view",
        x: 620,
        y: 0,
        props: {
          w: 400,
          h: 390,
          url: "https://unsplash.com",
          label: "Reference",
          mode: "url",
          htmlContent: "",
        },
      },
      {
        id: musicId,
        type: "web-view",
        x: 620,
        y: 410,
        props: {
          w: 400,
          h: 390,
          url: "https://open.spotify.com",
          label: "Now Playing",
          mode: "url",
          htmlContent: "",
        },
      },
    ],
    layout: {
      direction: "horizontal",
      children: [
        makeLeaf(canvasId, 0.6),
        makeSplit("vertical", [makeLeaf(refId, 0.5), makeLeaf(musicId, 0.5)], 0.4),
      ],
    },
  };
}

function buildHackerPreset(): PresetResult {
  const dataId = nextShapeId();
  const termId = nextShapeId();
  const nbId = nextShapeId();
  const noteId = nextShapeId();

  return {
    shapes: [
      {
        id: dataId,
        type: "data-node",
        x: 0,
        y: 0,
        props: {
          w: 500,
          h: 390,
          dataJson: JSON.stringify(
            { target: "", ports: [], services: [], notes: "" },
            null,
            2,
          ),
          label: "Recon",
        },
      },
      {
        id: termId,
        type: "terminal-node",
        x: 0,
        y: 410,
        props: {
          w: 500,
          h: 390,
          label: "Terminal",
          mode: "js",
          history: JSON.stringify([
            { type: "output", text: "SVG OS Terminal — ready" },
          ]),
          pendingCommand: "",
          runNonce: 0,
          clearNonce: 0,
        },
      },
      {
        id: nbId,
        type: "notebook-node",
        x: 520,
        y: 0,
        props: {
          w: 500,
          h: 390,
          label: "Jupyter",
          cells: JSON.stringify([
            {
              id: "c1",
              type: "code",
              lang: "python",
              source: "# CTF workspace\nprint('ready')",
              output: "",
            },
          ]),
          status: "idle",
          runNonce: 0,
          runMode: "all",
          activeCellId: "c1",
        },
      },
      {
        id: noteId,
        type: "note-node",
        x: 520,
        y: 410,
        props: {
          w: 500,
          h: 390,
          label: "Cheatsheet",
          content:
            "# Cheatsheet\n\n## Recon\n\n`nmap -sV target`\n\n`gobuster dir -u url -w wordlist`\n\n## SQLi\n\n`sqlmap -u url --dbs`\n\n## Reverse Shell\n\n`nc -lvnp 4444`\n\n## Notes\n\n",
          mode: "preview",
        },
      },
    ],
    layout: {
      direction: "horizontal",
      children: [
        makeSplit("vertical", [makeLeaf(dataId, 0.5), makeLeaf(termId, 0.5)], 0.5),
        makeSplit("vertical", [makeLeaf(nbId, 0.5), makeLeaf(noteId, 0.5)], 0.5),
      ],
    },
  };
}

function buildProgrammerPreset(): PresetResult {
  const aiId = nextShapeId();
  const noteId = nextShapeId();
  const webId = nextShapeId();

  return {
    shapes: [
      {
        id: aiId,
        type: "ai-node",
        x: 0,
        y: 0,
        props: {
          w: 600,
          h: 800,
          label: "Claude",
          prompt: "",
          response: "",
          model: getModel(),
          status: "idle",
          errorMessage: "",
          runNonce: 0,
        },
      },
      {
        id: noteId,
        type: "note-node",
        x: 620,
        y: 0,
        props: {
          w: 500,
          h: 390,
          label: "Notes",
          content:
            "# Notes\n\n## TODO\n\n- [ ] \n\n## Architecture\n\n\n## Decisions\n\n",
          mode: "edit",
        },
      },
      {
        id: webId,
        type: "web-view",
        x: 620,
        y: 410,
        props: {
          w: 500,
          h: 390,
          url: "https://devdocs.io",
          label: "Docs",
          mode: "url",
          htmlContent: "",
        },
      },
    ],
    layout: {
      direction: "horizontal",
      children: [
        makeLeaf(aiId, 0.5),
        makeSplit("vertical", [makeLeaf(noteId, 0.5), makeLeaf(webId, 0.5)], 0.5),
      ],
    },
  };
}

function buildDesignerPreset(): PresetResult {
  const desktopId = nextShapeId();
  const iphoneId = nextShapeId();
  const tableId = nextShapeId();

  return {
    shapes: [
      {
        id: desktopId,
        type: "web-view",
        x: 0,
        y: 0,
        props: {
          w: 500,
          h: 800,
          url: "",
          label: "Desktop",
          mode: "html",
          htmlContent: DESIGNER_HTML,
        },
      },
      {
        id: iphoneId,
        type: "web-view",
        x: 520,
        y: 0,
        props: {
          w: 400,
          h: 800,
          url: "",
          label: "iPhone",
          mode: "html",
          htmlContent: DESIGNER_IPHONE_HTML,
        },
      },
      {
        id: tableId,
        type: "table-node",
        x: 940,
        y: 0,
        props: {
          w: 380,
          h: 800,
          label: "Design Tokens",
          dataJson: JSON.stringify([
            { token: "primary", value: "#e6a756" },
            { token: "bg", value: "#1a1815" },
            { token: "card-bg", value: "#242220" },
            { token: "text", value: "#e8e4df" },
            { token: "muted", value: "#a09a90" },
            { token: "radius", value: "12px" },
            { token: "font", value: "Inter" },
          ]),
          selectedRow: -1,
          outputMode: "all",
        },
      },
    ],
    layout: {
      direction: "horizontal",
      children: [
        makeLeaf(desktopId, 0.4),
        makeLeaf(iphoneId, 0.3),
        makeLeaf(tableId, 0.3),
      ],
    },
    arrows: [
      { from: tableId, to: desktopId },
      { from: tableId, to: iphoneId },
    ],
  };
}

// ── Public factory ───────────────────────────────────────────────────────────

export function buildPreset(preset: PresetId): PresetResult | null {
  switch (preset) {
    case "claude-dev":
      return buildClaudeDevPreset();
    case "musician":
      return buildMusicianPreset();
    case "painter":
      return buildPainterPreset();
    case "hacker":
      return buildHackerPreset();
    case "programmer":
      return buildProgrammerPreset();
    case "designer":
      return buildDesignerPreset();
    case "blank":
      return null;
  }
}

/**
 * Materialize a preset into the editor — creates shapes, arrows, and returns
 * the tiled layout (if any) plus the descriptor.
 */
export function materializePreset(
  editor: Editor,
  preset: PresetId,
  name?: string,
): WorkspaceDescriptor {
  const id = crypto.randomUUID();
  const result = buildPreset(preset);

  if (result) {
    // Create shapes
    for (const spec of result.shapes) {
      editor.createShape({
        id: spec.id as never,
        type: spec.type as never,
        x: spec.x,
        y: spec.y,
        props: spec.props as never,
      });
    }

    // Create arrows for pre-wired connections
    if (result.arrows) {
      for (const arrow of result.arrows) {
        const arrowId = nextShapeId();
        editor.createShape({
          id: arrowId as never,
          type: "arrow" as never,
          x: 0,
          y: 0,
          props: {} as never,
        });
        editor.createBinding({
          fromId: arrowId as never,
          toId: arrow.from as never,
          type: "arrow",
          props: {
            terminal: "start",
            normalizedAnchor: { x: 0.5, y: 0.5 },
            isExact: false,
            isPrecise: true,
          },
        });
        editor.createBinding({
          fromId: arrowId as never,
          toId: arrow.to as never,
          type: "arrow",
          props: {
            terminal: "end",
            normalizedAnchor: { x: 0.5, y: 0.5 },
            isExact: false,
            isPrecise: true,
          },
        });
      }
    }
  }

  const descriptor: WorkspaceDescriptor = {
    id,
    name: name || PRESETS.find((p) => p.id === preset)?.name || "Workspace",
    preset,
    mode: preset === "blank" ? "canvas" : "tiled",
    tiledLayout: result?.layout,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  return descriptor;
}
