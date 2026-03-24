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
import { useEffect, useState } from "react";
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
function CanvasOverlays() {
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
      <CommandPalette open={cmdPaletteOpen} onClose={() => setCmdPaletteOpen(false)} />
    </>
  );
}

export function App() {
  const [wasmLoaded, setWasmLoaded] = useState(false);

  useEffect(() => {
    initWasm()
      .then(() => setWasmLoaded(true))
      .catch((err) => {
        console.warn("[svg-os] WASM init failed, continuing without bridge:", err);
        setWasmLoaded(true); // Don't block the canvas
      });
  }, []);

  return (
    <RuntimeProvider>
      <div style={{ position: "fixed", inset: 0 }}>
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
        <Tldraw
          shapeUtils={customShapeUtils}
          components={{
            InFrontOfTheCanvas: CanvasOverlays,
            TopPanel: null,
            SharePanel: null,
          }}
          onMount={(editor) => {
            editor.user.updateUserPreferences({ colorScheme: "dark" });
          }}
        />
      </div>
    </RuntimeProvider>
  );
}
