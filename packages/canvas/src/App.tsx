/**
 * SVG OS Canvas — tldraw infinite canvas with 3 node primitives:
 * DataNode, TransformNode, ViewNode.
 *
 * Phase 2: The @svg-os/core Runtime runs in parallel with the existing
 * reactive-engine.  A RuntimeBridge component syncs tldraw shapes into
 * the Runtime graph on mount.
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
import { syncShapesToRuntime, clearMappings } from "./lib/runtime-bridge";

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
 * has access to useRuntime).  On mount it syncs every existing tldraw
 * shape into the Runtime graph.
 */
function RuntimeBridge() {
  const editor = useEditor();
  const runtime = useRuntime();

  useEffect(() => {
    // Sync current page shapes into the Runtime graph
    syncShapesToRuntime(editor, runtime);

    // Listen for runtime node updates — future use for syncing back
    const unsub = runtime.events.on("node:updated", (_event) => {
      // Phase 3 will sync Runtime state back into tldraw shapes.
      // For now this is a no-op listener to verify the event bus works.
    });

    return () => {
      unsub();
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
