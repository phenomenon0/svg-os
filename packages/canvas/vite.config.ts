import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteStaticCopy } from "vite-plugin-static-copy";
import { viteMcpPlugin } from "./vite-mcp-plugin";

const base = process.env.CANVAS_BASE || "/";

export default defineConfig({
  root: ".",
  base,
  plugins: [
    react(),
    viteMcpPlugin(),
    viteStaticCopy({
      targets: [
        {
          src: "../bridge/wasm/svg_wasm_bg.wasm",
          dest: "assets",
        },
        {
          src: "../../fixtures/templates/*.svg",
          dest: "templates",
        },
      ],
    }),
  ],
  server: {
    port: 5190,
    fs: {
      allow: ["../.."],
    },
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "credentialless",
    },
  },
  optimizeDeps: {
    exclude: ["@svg-os/bridge"],
  },
});
