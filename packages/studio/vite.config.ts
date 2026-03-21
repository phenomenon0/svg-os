import { defineConfig } from "vite";
import { viteStaticCopy } from "vite-plugin-static-copy";

export default defineConfig({
  root: ".",
  build: {
    outDir: "dist",
  },
  server: {
    port: 5181,
  },
  plugins: [
    viteStaticCopy({
      targets: [
        {
          src: "../bridge/wasm/svg_wasm_bg.wasm",
          dest: "assets",
        },
      ],
    }),
  ],
  optimizeDeps: {
    exclude: ["@svg-os/bridge"],
  },
});
