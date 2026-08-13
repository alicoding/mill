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
  // Real cores, not files: 4 locally (tune against the machine), but 1
  // in CI (goal 0024 / ADR-0034's un-deferred CI target architecture --
  // Playwright's own CI guidance is workers: 1 for shared/limited-core
  // runners). Downgraded from workers: 2 after a real, traced incident:
  // a batch of 14 CI-only e2e failures turned out to be cross-worker
  // resource contention on the GitHub-hosted runner (each worker owns
  // its own isolated server + settings file, so it wasn't correctness,
  // it was two servers competing for the same limited CPU/IO), not
  // actual regressions -- they didn't reproduce locally or in isolation.
  // ci.yml now shards the suite into 3 parallel JOBS instead (real
  // process isolation, each on its own runner) to keep wall-clock time
  // down without reintroducing in-runner worker contention. The one
  // genuine shared-resource hazard left, the real OS clipboard, is
  // handled per-test via ./e2e/fixtures/clipboardLock.ts regardless of
  // worker count.
  workers: process.env.CI ? 1 : 4,
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
  // Playwright's own default reporter (list locally, dot in CI) never
  // writes a report to disk -- ci.yml's e2e job already expects one at
  // frontend/playwright-report on failure (its own upload-artifact
  // step), but with no reporter configured that path never existed:
  // "No files were found with the provided path" swallowed the one
  // artifact that would have shown per-failure screenshots/traces
  // instead of bare text logs. `open: 'never'` so a
  // local `npx playwright test` run never pops a browser tab
  // mid-session.
  reporter: [['html', { open: 'never' }], ['list']],
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
