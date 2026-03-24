import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 120_000,
  use: {
    baseURL: "http://localhost:5199",
    headless: true,
  },
  webServer: {
    command: "npx vite --port 5199",
    port: 5199,
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
