import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 120_000, // Pyodide takes time to load
  use: {
    baseURL: "http://localhost:5190",
    headless: true,
  },
  webServer: {
    command: "pnpm dev",
    port: 5190,
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
