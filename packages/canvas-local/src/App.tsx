/**
 * SVG OS Canvas Local — Tauri desktop version.
 *
 * Native-first: no WASM loading gate, no RuntimeProvider,
 * no collab overlay. Uses NativeRuntimeBridge for Rust IPC.
 */

import "tldraw/tldraw.css";
import { Tldraw } from "tldraw";
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
import { NodePalette } from "./components/NodePalette";
import { NodeInspector } from "./components/NodeInspector";
import { CommandPalette } from "./components/CommandPalette";
import { NativeRuntimeBridge } from "./lib/native-runtime-bridge";
import { useEffect, useState } from "react";

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
      <NativeRuntimeBridge />
      <NodePalette />
      <NodeInspector />
      <CommandPalette open={cmdPaletteOpen} onClose={() => setCmdPaletteOpen(false)} />
    </>
  );
}

export function App() {
  return (
    <div style={{ position: "fixed", inset: 0 }}>
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
  );
}
