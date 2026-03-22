import { defineConfig } from "vite";
import { viteStaticCopy } from "vite-plugin-static-copy";

export default defineConfig({
  root: ".",
  build: {
    outDir: "dist",
  },
  server: {
    port: 5180,
    fs: {
      allow: ["../.."],
    },
  },
  plugins: [
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
  optimizeDeps: {
    exclude: ["@svg-os/bridge"],
  },
});
