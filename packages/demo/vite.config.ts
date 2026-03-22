import { defineConfig } from "vite";
import { viteStaticCopy } from "vite-plugin-static-copy";
import { resolve } from "path";

export default defineConfig({
  root: ".",
  base: "./",
  build: {
    outDir: "dist",
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        architecture: resolve(__dirname, "architecture.html"),
        cards: resolve(__dirname, "cards.html"),
      },
    },
  },
  resolve: {
    // Allow Rollup to follow imports outside the demo package root
    preserveSymlinks: false,
  },
  server: {
    port: 5182,
    fs: {
      // Allow serving files from the monorepo root (for studio src + fixtures)
      allow: [resolve(__dirname, "../..")],
    },
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
