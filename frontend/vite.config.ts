import { execSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";
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

// Newest mtime (unix millis) among internal/**/*.go, walked AT REQUEST
// TIME rather than cached at vite startup -- goal 0029's dev-liveness
// signal. Deliberately Go-source-only (not git HEAD, not the whole
// repo): a docs-only or frontend-only commit must never move this
// value, matching goal 0019's already-learned lesson that a git-HEAD
// comparison false-alarms on exactly that kind of commit. Walking the
// tree per-request (rather than watching it) is cheap enough for a
// project this size and needs no extra watcher process to itself go
// stale.
function newestGoSourceMtimeMs(dir: string): number {
  let newest = 0;
  let entries: ReturnType<typeof readdirSync>;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return newest;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      newest = Math.max(newest, newestGoSourceMtimeMs(full));
    } else if (entry.isFile() && entry.name.endsWith(".go")) {
      try {
        newest = Math.max(newest, statSync(full).mtimeMs);
      } catch {
        // Race: file removed between readdir and stat -- skip it, the
        // next poll will see the settled state either way.
      }
    }
  }
  return newest;
}

// Dev-only middleware (configureServer only runs under `vite dev`/
// `wails3 dev`, never `vite build`) serving BuildIdentityBadge's
// go-liveness comparison input: `{ mtimeMs }`, the newest mtime under
// internal/**/*.go. Paired with BuildInfo.BuiltAt (the running Go
// binary's own executable mtime) in BuildIdentityBadge.tsx to detect a
// wedged or slow `wails3 dev` rebuild watcher -- SPEC §3.8, goal 0029.
function goLivenessPlugin(): Plugin {
  const internalDir = resolve(import.meta.dirname, "../internal");
  return {
    name: "mill-go-liveness",
    configureServer(server) {
      server.middlewares.use("/__mill/go-source-mtime", (_req, res) => {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ mtimeMs: newestGoSourceMtimeMs(internalDir) }));
      });
    },
  };
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
  plugins: [react(), wails("./bindings"), goLivenessPlugin()],
  test: {
    // e2e/**/*.spec.ts are Playwright tests (real browser + server),
    // not Vitest unit tests -- exclude them here or Vitest tries to run
    // them under its own runner and fails on @playwright/test's APIs.
    // Narrowed to *.spec.ts only (not all of e2e/**, goal 0156): the
    // layout-fitness predicate is authored once in e2e/ support code
    // and unit-tested by a co-located *.test.ts, which this exclude
    // must let Vitest's own default include glob still pick up.
    exclude: [...configDefaults.exclude, "e2e/**/*.spec.ts"],
    coverage: {
      provider: "v8",
      // lcov alongside the default text output: the changed-lines
      // coverage gate (goal 0109, diff-cover in CI) consumes
      // coverage/lcov.info; text stays for humans.
      reporter: ["text", "lcov"],
      // Hand-written source only -- generated Wails bindings are
      // exempt for the same we-don't-own-their-shape reason
      // scripts/check-loc.sh exempts them.
      include: ["src/**"],
      exclude: ["src/**/*.test.*", "src/locales/**"],
      // Floors are the MEASURED baseline at adoption (goal 0080),
      // rounded DOWN to integers and raised manually (same shape as
      // scripts/check-go-coverage.sh): a 2-decimal auto-ratchet made
      // every e2e-proven UI line a sub-0.1%% commit failure, which
      // fights this repo's own layering (components are deliberately
      // proven in e2e, not unit tests). Raise a floor in the same
      // commit that meaningfully raises real unit coverage.
      thresholds: {
        statements: 12,
        branches: 13,
        functions: 8,
        lines: 12,
      },
    },
  },
});
