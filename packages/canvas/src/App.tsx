/**
 * SVG OS Canvas — tldraw infinite canvas with 3 node primitives:
 * DataNode, TransformNode, ViewNode.
 *
 * Phase 3: The Runtime Scheduler is the single execution engine.
 * The RuntimeBridge component syncs tldraw changes into the Runtime graph,
 * triggers scheduler execution, and reads results back into shapes.
 * The legacy reactive-engine is kept as a fallback until fully verified.
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
import { NodePalette } from "./NodePalette";
import { ParameterPanel } from "./ParameterPanel";
import { AIChat } from "./AIChat";
import { initWasm } from "./lib/wasm-bridge";
import { wireReactiveEngine } from "./lib/reactive-engine";
import { useEffect, useState } from "react";
import { RuntimeProvider, useRuntime } from "./RuntimeContext";
import {
  syncShapesToRuntime,
  syncEdgesToRuntime,
  syncNodeConfig,
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
function scheduleRun(runtime: ReturnType<typeof useRuntime>) {
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
    // ── Initial sync: shapes + edges ──────────────────────────────────
    syncShapesToRuntime(editor, runtime);
    syncEdgesToRuntime(editor, runtime);

    // Kick an initial execution so nodes start with computed state
    scheduleRun(runtime);

    // ── Watch shape prop changes -> push config + schedule ────────────
    const unsubShape = editor.sideEffects.registerAfterChangeHandler(
      "shape",
      (prev, next) => {
        if (prev.props === next.props) return;
        syncNodeConfig(
          next.id,
          next.props as Record<string, unknown>,
          runtime,
        );
        scheduleRun(runtime);
      },
    );

    // ── Watch binding changes -> rebuild edges + schedule ─────────────
    const unsubStore = editor.store.listen(
      (entry) => {
        let bindingChanged = false;
        for (const record of Object.values(entry.changes.added)) {
          if (record.typeName === "binding") bindingChanged = true;
        }
        for (const record of Object.values(entry.changes.removed)) {
          if (record.typeName === "binding") bindingChanged = true;
        }
        if (bindingChanged) {
          // Clear and rebuild all runtime edges
          for (const edge of runtime.graph.getEdges()) {
            runtime.graph.removeEdge(edge.id);
          }
          syncEdgesToRuntime(editor, runtime);
          scheduleRun(runtime);
        }
      },
      { source: "all", scope: "document" },
    );

    // ── After scheduler finishes -> sync results back to shapes ──────
    const unsubExec = runtime.events.on("exec:complete", () => {
      syncRuntimeToShapes(editor, runtime);
    });

    return () => {
      unsubShape();
      unsubStore();
      unsubExec();
      clearMappings();
    };
  }, [editor, runtime]);

  return null;
}

// Stable component reference to avoid remounting
function CanvasOverlays() {
  return (
    <>
      <RuntimeBridge />
      <NodePalette />
      <ParameterPanel />
      <AIChat />
    </>
  );
}

export function App() {
  const [wasmLoaded, setWasmLoaded] = useState(false);

  useEffect(() => {
    initWasm()
      .then(() => setWasmLoaded(true))
      .catch(console.error);
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
          }}
          onMount={(editor) => {
            editor.user.updateUserPreferences({ colorScheme: "dark" });
            wireReactiveEngine(editor);
          }}
        />
      </div>
    </RuntimeProvider>
  );
}
