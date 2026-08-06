import { defineConfig } from "vite";
import { configDefaults } from "vitest/config";
import react from "@vitejs/plugin-react";
import wails from "@wailsio/runtime/plugins/vite";

// https://vitejs.dev/config/
export default defineConfig({
  server: {
    host: "127.0.0.1",
    port: Number(process.env.WAILS_VITE_PORT) || 9245,
    strictPort: true,
  },
  plugins: [react(), wails("./bindings")],
  test: {
    // e2e/**/*.spec.ts are Playwright tests (real browser + server),
    // not Vitest unit tests -- exclude them here or Vitest tries to run
    // them under its own runner and fails on @playwright/test's APIs.
    exclude: [...configDefaults.exclude, "e2e/**"],
  },
});
