/**
 * SVG OS Canvas — tldraw infinite canvas with SVG OS template shapes.
 */

import "tldraw/tldraw.css";
import { Tldraw } from "tldraw";
import { SvgTemplateShapeUtil } from "./shapes/SvgTemplateShape";
import { NodePalette } from "./NodePalette";
import { initWasm } from "./lib/wasm-bridge";
import { useEffect, useState } from "react";

const customShapeUtils = [SvgTemplateShapeUtil];

export function App() {
  const [wasmLoaded, setWasmLoaded] = useState(false);

  useEffect(() => {
    initWasm().then(() => setWasmLoaded(true)).catch(console.error);
  }, []);

  return (
    <div style={{ position: "fixed", inset: 0 }}>
      {!wasmLoaded && (
        <div style={{
          position: "absolute", inset: 0, zIndex: 9999,
          display: "flex", alignItems: "center", justifyContent: "center",
          background: "#0f172a", color: "#94a3b8",
          fontFamily: "Inter, sans-serif", fontSize: 14,
        }}>
          Loading SVG OS engine...
        </div>
      )}
      <Tldraw
        shapeUtils={customShapeUtils}
        components={{
          InFrontOfTheCanvas: NodePalette,
        }}
        onMount={(editor) => {
          // Set dark theme
          editor.user.updateUserPreferences({ colorScheme: "dark" });
        }}
      />
    </div>
  );
}
