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
];

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
        scheduleRun(runtime);
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
}) {
  const [cmdPaletteOpen, setCmdPaletteOpen] = useState(false);

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

  return (
    <>
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
      .catch(console.error);
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
