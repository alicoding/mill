import { execSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";
import { configDefaults } from "vitest/config";
import react from "@vitejs/plugin-react";
import wails from "@wailsio/runtime/plugins/vite";
import { pluginFrameDevMiddleware } from "./vite.config.frame.ts";

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
    // goal 0381: true only when MILL_DRIVE_BRIDGE=1 is set for this
    // build (internal/webviewbridgesmoke's own buildApp(), and
    // install:app's EXTRA_TAGS=mcp path) -- gates
    // shared/driveBridge.ts's window.__millRunCommand registration so
    // it tree-shakes out of every other build, the everyday `task
    // install:app` reinstall included.
    __MILL_DRIVE_BRIDGE__: JSON.stringify(process.env.MILL_DRIVE_BRIDGE === "1"),
  },
  server: {
    host: "127.0.0.1",
    port: Number(process.env.WAILS_VITE_PORT) || 9245,
    strictPort: true,
  },
  build: {
    // A vendored diagram/editor engine (elk.bundled, milkdownCore,
    // typescript, the mermaid/katex core chunk) legitimately clears
    // Rolldown's 500kB default before any code-splitting -- vendoring
    // for completeness rather than trimming capability for MB is this
    // repo's own stance, so the fix for that class of warning is
    // raising the limit past today's largest real chunk, not chasing
    // a split that would just reshuffle the same bytes. The largest
    // single chunk today is `index-*.js` (Mill's own app entry, not a
    // vendored engine) at 1,994kB, produced by no route-level code
    // splitting existing yet -- every view (Board/Atlas/Settings/...)
    // imports eagerly from src/app/main.tsx. Revisit this limit (split
    // via React.lazy per view, the converged pattern) when that same
    // chunk crosses 2,000kB, or when a second contributor to app-code
    // size (not a vendored engine) pushes any chunk past this limit.
    chunkSizeWarningLimit: 2200,
    rolldownOptions: {
      // Rolldown's onwarn is a deprecated alias (its own type comment
      // points at onLog); onLog is the current interception point and
      // the one Rolldown's own docs use for this exact "no warning
      // survives a build" pattern. A warning raised by a native
      // builtin plugin (e.g. the large-chunk reporter) logs through
      // this same hook but doesn't propagate a thrown exception into
      // the build's own promise chain, so exitCode is set directly
      // rather than relied on to come from the throw.
      onLog(level, log) {
        if (level === "warn") {
          const message = `[vite build] warning treated as error: ${log.code ?? ""} ${log.message}`;
          console.error(message);
          process.exitCode = 1;
          throw new Error(message);
        }
      },
    },
  },
  plugins: [react(), wails("./bindings"), goLivenessPlugin(), pluginFrameDevMiddleware()],
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
      // *.typecheck.ts (goal 0180 S1's literal-union proof): compile-time
      // -only assertions nothing imports at runtime -- would otherwise
      // report as permanently 0% covered and drag the aggregate down.
      exclude: ["src/**/*.test.*", "src/**/*.typecheck.ts", "src/locales/**"],
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
