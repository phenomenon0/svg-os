/**
 * SVG OS Canvas — tldraw infinite canvas with 3 node primitives:
 * DataNode, TransformNode, ViewNode.
 */

import "tldraw/tldraw.css";
import { Tldraw } from "tldraw";
import { DataNodeShapeUtil } from "./shapes/DataNodeShape";
import { TransformNodeShapeUtil } from "./shapes/TransformNodeShape";
import { ViewNodeShapeUtil } from "./shapes/ViewNodeShape";
import { TableNodeShapeUtil } from "./shapes/TableNodeShape";
import { MultiplexerNodeShapeUtil } from "./shapes/MultiplexerNodeShape";
import { WebViewShapeUtil } from "./shapes/WebViewShape";
import { TerminalNodeShapeUtil } from "./shapes/TerminalNodeShape";
import { NodePalette } from "./NodePalette";
import { ParameterPanel } from "./ParameterPanel";
import { initWasm } from "./lib/wasm-bridge";
import { wireReactiveEngine } from "./lib/reactive-engine";
import { useEffect, useState } from "react";

const customShapeUtils = [
  DataNodeShapeUtil,
  TransformNodeShapeUtil,
  ViewNodeShapeUtil,
  TableNodeShapeUtil,
  MultiplexerNodeShapeUtil,
  WebViewShapeUtil,
  TerminalNodeShapeUtil,
];

// Stable component reference to avoid remounting
function CanvasOverlays() {
  return (
    <>
      <NodePalette />
      <ParameterPanel />
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
  );
}
