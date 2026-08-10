import { execSync } from "node:child_process";
import { defineConfig } from "vite";
import { configDefaults } from "vitest/config";
import react from "@vitejs/plugin-react";
import wails from "@wailsio/runtime/plugins/vite";

// The repo's HEAD at bundle-compile time -- compared at runtime against
// the Go binary's own embedded build commit (SettingsService.GetBuildInfo)
// to surface a STALE BUILD mismatch badge (docs/SPEC.md §3.8's
// dev-staleness class: `task dev` serves a fresh bundle while an
// orphaned old binary answers the RPCs; nothing else can catch that).
// Guarded: a build outside a git checkout just disables the comparison.
function repoHead(): string {
  try {
    return execSync("git rev-parse --short=7 HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "";
  }
}

// https://vitejs.dev/config/
export default defineConfig({
  define: {
    __MILL_REPO_HEAD__: JSON.stringify(repoHead()),
  },
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
