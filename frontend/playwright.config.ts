import { defineConfig } from '@playwright/test'

// Drives Mill's own Wails3 server mode (see ../.claude/skills/run-mill/SKILL.md)
// instead of a plain frontend dev server -- real Go service bindings over
// HTTP, not a mock. Requires frontend/dist to already exist (go:embed) --
// same prerequisite as everything else in this repo.
//
// goal 0009 (docs/goals/0009-e2e-parallel-isolation.md): each worker now
// spawns its OWN mill-server process against its own throwaway
// MILL_SETTINGS_PATH/MILL_EXECUTION_DB_PATH (./e2e/fixtures/server.ts),
// replacing the single shared `webServer` this config used to declare --
// that's what let `workers` go above 1. The binary itself is still built
// exactly once, in globalSetup, before any worker starts.
export default defineConfig({
  testDir: './e2e',
  // Real cores, not files: 4 locally (tune against the machine), fewer
  // in CI where the runner typically has less parallel headroom. Each
  // worker owns a fully isolated server + settings file (fixtures/
  // server.ts), so raising this only costs machine resources, never
  // correctness -- the one genuine shared-resource hazard left, the
  // real OS clipboard, is handled per-test via
  // ./e2e/fixtures/clipboardLock.ts, not by capping worker count.
  workers: process.env.CI ? 2 : 4,
  // fullyParallel stays false (Playwright's own default): tests within
  // one spec FILE still run serially against that worker's one server,
  // since several files deliberately share state/fixtures across their
  // own tests (e.g. composition.spec.ts's "Load sample HTML" row).
  // Different files still run concurrently across workers -- that's the
  // actual lever this goal pulls.
  fullyParallel: false,
  // One retry: the resizable-table drag test measures column width
  // after a synthetic pointer drag, which under load occasionally has
  // pointermove events coalesced (the column moves only partway) -- a
  // genuine timing flake, not a resize bug (it passes isolated and on
  // retry). A real regression still fails both attempts, so this masks
  // flakes without hiding breakage.
  retries: 1,
  // Default (30s) is too tight now that a dozen or so tests across
  // several files contend for the one real-clipboard lock
  // (./e2e/fixtures/clipboardLock.ts) -- under parallel workers, a test
  // can now spend real time queued behind several others before it even
  // starts its own steps, which a serial (workers: 1) suite never had
  // to account for since nothing else was ever running concurrently.
  // Caught directly as a real spurious timeout, not pre-emptively
  // padded on a guess.
  timeout: 60_000,
  globalSetup: './e2e/global-setup.ts',
  use: {
    // No static baseURL here -- ./e2e/fixtures/server.ts overrides the
    // `baseURL` fixture per worker, pointed at that worker's own
    // freshly-spawned server. Every spec imports `test`/`expect` from
    // that module (not '@playwright/test' directly) specifically so
    // this applies; specs themselves only ever call page.goto('/'),
    // relative, so they inherit whichever worker they land on.
  },
})
