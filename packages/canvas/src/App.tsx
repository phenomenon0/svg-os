/**
 * SVG OS Canvas — tldraw infinite canvas with 3 node primitives:
 * DataNode, TransformNode, ViewNode.
 *
 * Phase 3: The Runtime Scheduler is the single execution engine.
 * The RuntimeBridge component syncs tldraw changes into the Runtime graph,
 * triggers scheduler execution, and reads results back into shapes.
 */

import "tldraw/tldraw.css";
import { Tldraw, useEditor } from "tldraw";
import { DataNodeShapeUtil } from "./shapes/DataNodeShape";
import { TransformNodeShapeUtil } from "./shapes/TransformNodeShape";
import { ViewNodeShapeUtil } from "./shapes/ViewNodeShape";
import { TableNodeShapeUtil } from "./shapes/TableNodeShape";
import { WebViewShapeUtil } from "./shapes/WebViewShape";
import { TerminalNodeShapeUtil } from "./shapes/TerminalNodeShape";
import { NoteNodeShapeUtil } from "./shapes/NoteNodeShape";
import { NotebookNodeShapeUtil } from "./shapes/NotebookNodeShape";
import { AINodeShapeUtil } from "./shapes/AINodeShape";
import { CompactNodeShapeUtil } from "./shapes/CompactNodeShape";
import { MediaNodeShapeUtil } from "./shapes/MediaNodeShape";
import { NodePalette } from "./NodePalette";
import { NodeInspector } from "./NodeInspector";
import { AIChat } from "./AIChat";
import { CollabOverlay } from "./CollabOverlay";
import { initWasm } from "./lib/wasm-bridge";
import { useEffect, useState, useCallback, useRef } from "react";
import type { Runtime } from "@svg-os/core";
import { RuntimeProvider, useRuntime } from "./RuntimeContext";
import { CommandPalette } from "./CommandPalette";
import {
  ensureShapeNode,
  hasRuntimeConfigChanges,
  rebuildEdges,
  removeShapeNode,
  syncShapeNode,
  syncShapesToRuntime,
  syncRuntimeToShapes,
  clearMappings,
} from "./lib/runtime-bridge";
import type { WorkspaceDescriptor, PresetId } from "./lib/workspace";
import {
  saveWorkspace,
  captureWorkspace,
  materializePreset,
  setActiveWorkspaceId,
} from "./lib/workspace";
import { WorkspaceSelector, PresetModal, WORKSPACE_BAR_HEIGHT } from "./WorkspaceSelector";
import { applyTiledLayout, restoreCanvasMode, clearSavedPositions } from "./TiledMode";
import { TiledPanelOverlay } from "./TiledPanelOverlay";
import { createCanvasAPI } from "./lib/canvas-api";
import { initMcpBridge } from "./lib/mcp-bridge";

const customShapeUtils = [
  DataNodeShapeUtil,
  TransformNodeShapeUtil,
  ViewNodeShapeUtil,
  TableNodeShapeUtil,
  WebViewShapeUtil,
  TerminalNodeShapeUtil,
  NoteNodeShapeUtil,
  NotebookNodeShapeUtil,
  AINodeShapeUtil,
  CompactNodeShapeUtil,
  MediaNodeShapeUtil,
];

// ── Canvas-level file drop handler ─────────────────────────────────────────

function parseCSVToRows(text: string): Record<string, string>[] {
  const lines = text.trim().split("\n").map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) return [];
  const delim = lines[0].includes("\t") ? "\t" : ",";
  const headers = lines[0].split(delim).map(h => h.trim().replace(/^["']|["']$/g, ""));
  return lines.slice(1).map(line => {
    const vals = line.split(delim).map(v => v.trim().replace(/^["']|["']$/g, ""));
    const row: Record<string, string> = {};
    headers.forEach((h, j) => row[h] = vals[j] || "");
    return row;
  });
}

function CanvasDropZone({ children }: { children: React.ReactNode }) {
  const [dragOver, setDragOver] = useState(false);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);

    const file = e.dataTransfer.files[0];
    if (!file) return;

    // We need the editor — get it from window (exposed by RuntimeBridge)
    const editor = (window as any).__tldrawEditor;
    if (!editor) return;

    // Convert screen position to canvas position
    const point = editor.screenToPage({ x: e.clientX, y: e.clientY });
    const ext = file.name.split(".").pop()?.toLowerCase() || "";
    const mime = file.type;

    // JSON → Data node
    if (ext === "json" || mime === "application/json") {
      const text = await file.text();
      try {
        JSON.parse(text); // validate
        editor.createShape({
          type: "data-node",
          x: point.x - 150, y: point.y - 100,
          props: { w: 300, h: 200, label: file.name, dataJson: text },
        });
      } catch { /* invalid JSON, skip */ }
      return;
    }

    // CSV/TSV → Table node
    if (ext === "csv" || ext === "tsv" || mime === "text/csv") {
      const text = await file.text();
      const rows = parseCSVToRows(text);
      if (rows.length > 0) {
        editor.createShape({
          type: "table-node",
          x: point.x - 180, y: point.y - 120,
          props: { w: 400, h: 280, label: file.name, dataJson: JSON.stringify(rows), dataSource: "local" },
        });
      }
      return;
    }

    // Image → Media node
    if (mime.startsWith("image/")) {
      const dataUrl = await readFileAsDataUrl(file);
      editor.createShape({
        type: "media-node",
        x: point.x - 160, y: point.y - 130,
        props: {
          w: 320, h: 260, label: file.name.split(".").slice(0, -1).join(".") || file.name,
          mediaType: "image", src: dataUrl, filename: file.name,
          mimeType: mime, fileSize: file.size,
        },
      });
      return;
    }

    // Video → Media node
    if (mime.startsWith("video/")) {
      const dataUrl = await readFileAsDataUrl(file);
      editor.createShape({
        type: "media-node",
        x: point.x - 200, y: point.y - 150,
        props: {
          w: 400, h: 300, label: file.name.split(".").slice(0, -1).join(".") || file.name,
          mediaType: "video", src: dataUrl, filename: file.name,
          mimeType: mime, fileSize: file.size,
        },
      });
      return;
    }

    // Audio → Media node
    if (mime.startsWith("audio/")) {
      const dataUrl = await readFileAsDataUrl(file);
      editor.createShape({
        type: "media-node",
        x: point.x - 160, y: point.y - 80,
        props: {
          w: 320, h: 160, label: file.name.split(".").slice(0, -1).join(".") || file.name,
          mediaType: "audio", src: dataUrl, filename: file.name,
          mimeType: mime, fileSize: file.size,
        },
      });
      return;
    }

    // Other text files → Data node with raw content
    if (mime.startsWith("text/") || ext === "txt" || ext === "md" || ext === "yaml" || ext === "yml" || ext === "xml") {
      const text = await file.text();
      editor.createShape({
        type: "data-node",
        x: point.x - 150, y: point.y - 100,
        props: { w: 300, h: 200, label: file.name, dataJson: JSON.stringify({ content: text, filename: file.name }) },
      });
      return;
    }
  }, []);

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      style={{ position: "fixed", inset: 0 }}
    >
      {dragOver && (
        <div style={{
          position: "absolute", inset: 0, zIndex: 9998,
          background: "rgba(139, 92, 246, 0.08)",
          border: "3px dashed rgba(139, 92, 246, 0.4)",
          borderRadius: 12,
          display: "flex", alignItems: "center", justifyContent: "center",
          pointerEvents: "none",
        }}>
          <span style={{ color: "#8b5cf6", fontSize: 16, fontFamily: "Inter, sans-serif", fontWeight: 500 }}>
            Drop file to create node
          </span>
        </div>
      )}
      {children}
    </div>
  );
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * RuntimeBridge — invisible component that lives inside the tldraw tree
 * (so it has access to useEditor) AND inside the RuntimeProvider (so it
 * has access to useRuntime).
 *
 * Phase 3: this is the primary execution path.  It detects tldraw store
 * changes, syncs them into the Runtime graph, calls the Scheduler, and
 * reads results back into tldraw shapes.
 */
let pendingRun = false;
function scheduleRun(runtime: Runtime) {
  if (pendingRun) return;
  pendingRun = true;
  requestAnimationFrame(() => {
    pendingRun = false;
    runtime.run().catch(console.error);
  });
}

function RuntimeBridge() {
  const editor = useEditor();
  const runtime = useRuntime();

  // Expose editor and runtime for E2E tests
  useEffect(() => {
    (window as any).__tldrawEditor = editor;
    (window as any).__svgosRuntime = runtime;
    return () => {
      delete (window as any).__tldrawEditor;
      delete (window as any).__svgosRuntime;
    };
  }, [editor, runtime]);

  useEffect(() => {
    if (!runtime) return;
    // ── Initial sync: shapes + edges ──────────────────────────────────
    syncShapesToRuntime(editor, runtime);
    rebuildEdges(editor, runtime);

    // Kick an initial execution so nodes start with computed state
    scheduleRun(runtime);

    // ── Watch shape prop changes -> push config + schedule ────────────
    const unsubShape = editor.sideEffects.registerAfterChangeHandler(
      "shape",
      (prev, next) => {
        if (next.type === "arrow") return;

        const propsChanged = hasRuntimeConfigChanges(
          next.type,
          prev.props as Record<string, unknown>,
          next.props as Record<string, unknown>,
        );
        const metaChanged =
          prev.x !== next.x ||
          prev.y !== next.y ||
          (prev.props as Record<string, unknown>).w !== (next.props as Record<string, unknown>).w ||
          (prev.props as Record<string, unknown>).h !== (next.props as Record<string, unknown>).h;
        if (!propsChanged && !metaChanged) return;

        syncShapeNode(next as never, runtime);

        // Don't auto-run the graph for manual-trigger nodes (notebook, terminal)
        // Their execution is driven by the user clicking Run, not by prop changes
        const manualTypes = new Set(["notebook-node", "terminal-node"]);
        if (!manualTypes.has(next.type)) {
          scheduleRun(runtime);
        }
      },
    );

    // ── Watch shape add/remove + binding changes ──────────────────────
    const unsubStore = editor.store.listen(
      (entry) => {
        let shapeChanged = false;
        let bindingChanged = false;

        for (const record of Object.values(entry.changes.added)) {
          if (record.typeName === "shape" && (record as { type?: string }).type !== "arrow") {
            ensureShapeNode(record as never, runtime);
            shapeChanged = true;
          }
          if (record.typeName === "binding") bindingChanged = true;
        }
        for (const record of Object.values(entry.changes.removed)) {
          if (record.typeName === "shape" && (record as { type?: string }).type !== "arrow") {
            removeShapeNode(record.id, runtime);
            shapeChanged = true;
          }
          if (record.typeName === "binding") bindingChanged = true;
        }

        if (bindingChanged) {
          rebuildEdges(editor, runtime);
        }

        if (shapeChanged || bindingChanged) {
          scheduleRun(runtime);
        }
      },
      { source: "all", scope: "document" },
    );

    const syncOutputs = () => {
      syncRuntimeToShapes(editor, runtime);
    };
    const unsubNodeStart = runtime.events.on("exec:node-start", syncOutputs);
    const unsubNodeComplete = runtime.events.on("exec:node-complete", syncOutputs);
    const unsubExec = runtime.events.on("exec:complete", syncOutputs);

    return () => {
      unsubShape();
      unsubStore();
      unsubNodeStart();
      unsubNodeComplete();
      unsubExec();
      clearMappings();
    };
  }, [editor, runtime]);

  return null;
}

// Stable component reference to avoid remounting
function CanvasOverlays({
  onOpenPresetModal,
  onToggleTiled,
  workspace,
  setWorkspace,
}: {
  onOpenPresetModal?: () => void;
  onToggleTiled?: () => void;
  workspace?: WorkspaceDescriptor | null;
  setWorkspace?: (d: WorkspaceDescriptor) => void;
} = {}) {
  const editor = useEditor();
  const [cmdPaletteOpen, setCmdPaletteOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  // ── File drop handler (capture phase to intercept before tldraw) ────
  useEffect(() => {
    if (!editor) return;
    let dragCount = 0;

    const onDragOver = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes("Files")) {
        e.preventDefault();
        e.stopPropagation();
        if (!dragCount) setDragOver(true);
        dragCount++;
      }
    };
    const onDragLeave = (e: DragEvent) => {
      dragCount = Math.max(0, dragCount - 1);
      if (dragCount === 0) setDragOver(false);
    };
    const onDrop = async (e: DragEvent) => {
      dragCount = 0;
      setDragOver(false);
      const file = e.dataTransfer?.files[0];
      if (!file) return;

      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      const point = editor.screenToPage({ x: e.clientX, y: e.clientY });
      const ext = file.name.split(".").pop()?.toLowerCase() || "";
      const mime = file.type;

      if (ext === "json" || mime === "application/json") {
        const text = await file.text();
        try { JSON.parse(text); editor.createShape({ type: "data-node", x: point.x - 150, y: point.y - 100, props: { w: 300, h: 200, label: file.name, dataJson: text } }); } catch {}
        return;
      }
      if (ext === "csv" || ext === "tsv" || mime === "text/csv") {
        const text = await file.text();
        const rows = parseCSVToRows(text);
        if (rows.length > 0) editor.createShape({ type: "table-node", x: point.x - 180, y: point.y - 120, props: { w: 400, h: 280, label: file.name, dataJson: JSON.stringify(rows), dataSource: "local" } });
        return;
      }
      if (mime.startsWith("image/")) {
        const dataUrl = await readFileAsDataUrl(file);
        editor.createShape({ type: "media-node", x: point.x - 160, y: point.y - 130, props: { w: 320, h: 260, label: file.name.replace(/\.[^.]+$/, ""), mediaType: "image", src: dataUrl, filename: file.name, mimeType: mime, fileSize: file.size } });
        return;
      }
      if (mime.startsWith("video/")) {
        const dataUrl = await readFileAsDataUrl(file);
        editor.createShape({ type: "media-node", x: point.x - 200, y: point.y - 150, props: { w: 400, h: 300, label: file.name.replace(/\.[^.]+$/, ""), mediaType: "video", src: dataUrl, filename: file.name, mimeType: mime, fileSize: file.size } });
        return;
      }
      if (mime.startsWith("audio/")) {
        const dataUrl = await readFileAsDataUrl(file);
        editor.createShape({ type: "media-node", x: point.x - 160, y: point.y - 80, props: { w: 320, h: 160, label: file.name.replace(/\.[^.]+$/, ""), mediaType: "audio", src: dataUrl, filename: file.name, mimeType: mime, fileSize: file.size } });
        return;
      }
      if (mime.startsWith("text/") || ["txt", "md", "yaml", "yml", "xml"].includes(ext)) {
        const text = await file.text();
        editor.createShape({ type: "data-node", x: point.x - 150, y: point.y - 100, props: { w: 300, h: 200, label: file.name, dataJson: JSON.stringify({ content: text, filename: file.name }) } });
      }
    };

    // Capture phase: intercept BEFORE tldraw
    document.addEventListener("dragover", onDragOver, { capture: true });
    document.addEventListener("dragleave", onDragLeave, { capture: true });
    document.addEventListener("drop", onDrop, { capture: true });
    return () => {
      document.removeEventListener("dragover", onDragOver, { capture: true });
      document.removeEventListener("dragleave", onDragLeave, { capture: true });
      document.removeEventListener("drop", onDrop, { capture: true });
    };
  }, [editor]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setCmdPaletteOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const handleCanvasDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);

    const file = e.dataTransfer.files[0];
    if (!file || !editor) return;

    const point = editor.screenToPage({ x: e.clientX, y: e.clientY });
    const ext = file.name.split(".").pop()?.toLowerCase() || "";
    const mime = file.type;

    if (ext === "json" || mime === "application/json") {
      const text = await file.text();
      try { JSON.parse(text); editor.createShape({ type: "data-node", x: point.x - 150, y: point.y - 100, props: { w: 300, h: 200, label: file.name, dataJson: text } }); } catch {}
      return;
    }
    if (ext === "csv" || ext === "tsv" || mime === "text/csv") {
      const text = await file.text();
      const rows = parseCSVToRows(text);
      if (rows.length > 0) editor.createShape({ type: "table-node", x: point.x - 180, y: point.y - 120, props: { w: 400, h: 280, label: file.name, dataJson: JSON.stringify(rows), dataSource: "local" } });
      return;
    }
    if (mime.startsWith("image/")) {
      const dataUrl = await readFileAsDataUrl(file);
      editor.createShape({ type: "media-node", x: point.x - 160, y: point.y - 130, props: { w: 320, h: 260, label: file.name.replace(/\.[^.]+$/, ""), mediaType: "image", src: dataUrl, filename: file.name, mimeType: mime, fileSize: file.size } });
      return;
    }
    if (mime.startsWith("video/")) {
      const dataUrl = await readFileAsDataUrl(file);
      editor.createShape({ type: "media-node", x: point.x - 200, y: point.y - 150, props: { w: 400, h: 300, label: file.name.replace(/\.[^.]+$/, ""), mediaType: "video", src: dataUrl, filename: file.name, mimeType: mime, fileSize: file.size } });
      return;
    }
    if (mime.startsWith("audio/")) {
      const dataUrl = await readFileAsDataUrl(file);
      editor.createShape({ type: "media-node", x: point.x - 160, y: point.y - 80, props: { w: 320, h: 160, label: file.name.replace(/\.[^.]+$/, ""), mediaType: "audio", src: dataUrl, filename: file.name, mimeType: mime, fileSize: file.size } });
      return;
    }
    // Fallback: text file → data node
    if (mime.startsWith("text/") || ["txt", "md", "yaml", "yml", "xml"].includes(ext)) {
      const text = await file.text();
      editor.createShape({ type: "data-node", x: point.x - 150, y: point.y - 100, props: { w: 300, h: 200, label: file.name, dataJson: JSON.stringify({ content: text, filename: file.name }) } });
    }
  }, [editor]);

  return (
    <>
      {/* Drop zone visual overlay */}
      {dragOver && (
        <div style={{
          position: "absolute", inset: 8, zIndex: 9000,
          background: "rgba(139, 92, 246, 0.06)",
          border: "2px dashed rgba(139, 92, 246, 0.4)",
          borderRadius: 12,
          display: "flex", alignItems: "center", justifyContent: "center",
          pointerEvents: "none",
        }}>
          <span style={{ color: "#8b5cf6", fontSize: 14, fontFamily: "Inter, sans-serif", fontWeight: 500 }}>
            Drop file to create node
          </span>
        </div>
      )}
      <RuntimeBridge />
      <CollabOverlay />
      <NodePalette />
      <NodeInspector />
      <CommandPalette
        open={cmdPaletteOpen}
        onClose={() => setCmdPaletteOpen(false)}
        onOpenPresetModal={onOpenPresetModal}
        onToggleTiled={onToggleTiled}
      />
      {workspace && workspace.mode === "tiled" && setWorkspace && (
        <TiledPanelOverlay
          descriptor={workspace}
          setDescriptor={setWorkspace}
        />
      )}
    </>
  );
}

export function App() {
  const [wasmLoaded, setWasmLoaded] = useState(false);
  const [workspace, setWorkspace] = useState<WorkspaceDescriptor | null>(null);
  const [presetModalOpen, setPresetModalOpen] = useState(false);
  const editorRef = useRef<import("tldraw").Editor | null>(null);
  const runtimeRef = useRef<Runtime | null>(null);

  useEffect(() => {
    initWasm()
      .then(() => setWasmLoaded(true))
      .catch((err) => {
        console.warn("[svg-os] WASM init failed, continuing without bridge:", err);
        setWasmLoaded(true); // Don't block the canvas
      });
  }, []);

  // ── MCP bridge: connect browser to Vite MCP plugin ──────────────────
  const workspaceRef = useRef(workspace);
  workspaceRef.current = workspace;

  useEffect(() => {
    const editor = editorRef.current;
    const runtime = runtimeRef.current;
    if (!editor) return;

    const api = createCanvasAPI(
      editor,
      runtime,
      () => workspaceRef.current,
      setWorkspace,
    );
    const bridge = initMcpBridge(api);
    return () => bridge.disconnect();
  }, [wasmLoaded]); // re-init after wasm loads (editor is ready)

  const handleExitWorkspace = useCallback(() => {
    if (workspace && editorRef.current && runtimeRef.current) {
      const snapshot = captureWorkspace(editorRef.current, runtimeRef.current, workspace);
      saveWorkspace(snapshot);
      if (workspace.mode === "tiled") {
        restoreCanvasMode(editorRef.current);
      }
    }
    clearSavedPositions();
    setActiveWorkspaceId(null);
    setWorkspace(null);
  }, [workspace]);

  const handleCreateFromPreset = useCallback(
    (presetId: PresetId) => {
      const editor = editorRef.current;
      const runtime = runtimeRef.current;
      if (!editor) return;

      // Save current workspace if any
      if (workspace && runtime) {
        const snapshot = captureWorkspace(editor, runtime, workspace);
        saveWorkspace(snapshot);
        if (workspace.mode === "tiled") {
          restoreCanvasMode(editor);
        }
      }
      clearSavedPositions();
      clearMappings();

      // Clear canvas
      const allShapes = editor.getCurrentPageShapes();
      if (allShapes.length > 0) {
        editor.deleteShapes(allShapes.map((s) => s.id));
      }

      // Build new workspace
      const desc = materializePreset(editor, presetId);
      setWorkspace(desc);
      setActiveWorkspaceId(desc.id);

      // Apply tiled layout
      if (desc.mode === "tiled" && desc.tiledLayout) {
        requestAnimationFrame(() => {
          applyTiledLayout(editor, desc.tiledLayout!);
        });
      } else {
        editor.zoomToFit({ animation: { duration: 200 } });
      }

      setPresetModalOpen(false);
    },
    [workspace],
  );

  const handleToggleTiled = useCallback(() => {
    if (!workspace || !editorRef.current) return;
    const editor = editorRef.current;
    const newMode = workspace.mode === "tiled" ? "canvas" : "tiled";
    const updated = { ...workspace, mode: newMode as "canvas" | "tiled", updatedAt: Date.now() };

    if (newMode === "tiled" && updated.tiledLayout) {
      applyTiledLayout(editor, updated.tiledLayout);
    } else {
      restoreCanvasMode(editor);
    }

    setWorkspace(updated);
  }, [workspace]);

  // Stable component ref for InFrontOfTheCanvas
  const OverlayComponent = useCallback(
    () => (
      <CanvasOverlays
        onOpenPresetModal={() => setPresetModalOpen(true)}
        onToggleTiled={handleToggleTiled}
        workspace={workspace}
        setWorkspace={setWorkspace}
      />
    ),
    [handleToggleTiled, workspace],
  );

  const hasWorkspaceBar = workspace !== null;

  return (
    <RuntimeProvider>
      <RuntimeRefCapture runtimeRef={runtimeRef} />
      <div style={{ position: "fixed", inset: 0, display: "flex", flexDirection: "column" }}>
        {!wasmLoaded && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              zIndex: 9999,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "#0f172a",
              color: "#94a3b8",
              fontFamily: "Inter, sans-serif",
              fontSize: 14,
            }}
          >
            Loading SVG OS engine...
          </div>
        )}

        <div style={{ flex: 1, position: "relative" }}>
          <Tldraw
            shapeUtils={customShapeUtils}
            components={{
              InFrontOfTheCanvas: OverlayComponent,
              TopPanel: null,
              SharePanel: null,
            }}
            onMount={(editor) => {
              editor.user.updateUserPreferences({ colorScheme: "dark" });
              editorRef.current = editor;
            }}
          />

          {/* Workspace bar overlays on top of tldraw */}
          {hasWorkspaceBar && (
            <div style={{ position: "absolute", top: 0, left: 0, right: 0, zIndex: 2000 }}>
              <WorkspaceSelector
                descriptor={workspace}
                setDescriptor={setWorkspace}
                onExit={handleExitWorkspace}
              />
            </div>
          )}
        </div>

        {/* Preset modal (standalone, for CommandPalette trigger) */}
        {presetModalOpen && !hasWorkspaceBar && (
          <PresetModal
            onSelect={handleCreateFromPreset}
            onClose={() => setPresetModalOpen(false)}
          />
        )}
      </div>
    </RuntimeProvider>
  );
}

/** Captures the runtime ref from inside the provider */
function RuntimeRefCapture({ runtimeRef }: { runtimeRef: React.MutableRefObject<Runtime | null> }) {
  const runtime = useRuntime();
  useEffect(() => {
    runtimeRef.current = runtime;
  }, [runtime, runtimeRef]);
  return null;
}
