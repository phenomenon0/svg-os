import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteStaticCopy } from "vite-plugin-static-copy";

export default defineConfig({
  root: ".",
  plugins: [
    react(),
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
  },
  optimizeDeps: {
    exclude: ["@svg-os/bridge"],
  },
});
