import { defineConfig } from '@playwright/test'

// Drives Mill's own Wails3 server mode (see ../.claude/skills/run-mill/SKILL.md)
// instead of a plain frontend dev server -- real Go service bindings over
// HTTP, not a mock. Requires frontend/dist to already exist (go:embed) --
// same prerequisite as everything else in this repo.
export default defineConfig({
  testDir: './e2e',
  // Real OS clipboard I/O (composition.spec.ts's/activity.spec.ts's
  // workflow-run tests, internal/adapters/clipboard's own Go tests) is a
  // single shared global resource, not something safe to parallelize
  // against -- confirmed by direct reproduction, not assumed: with
  // Playwright's default multi-worker parallelism, one test's
  // WriteHTML() could be clobbered by a concurrently-running test's own
  // clipboard write before the first ever read it back, surfacing as an
  // intermittent "no HTML on clipboard" failure with no code bug behind
  // it. Serializing is the honest fix given these are deliberately real
  // integration tests, not mocks (ADR-0002) -- the alternative would be
  // mocking the one thing most likely to actually break.
  workers: 1,
  // One retry: the resizable-table drag test measures column width
  // after a synthetic pointer drag, which under full-suite load
  // occasionally has pointermove events coalesced (the column moves
  // only partway) -- a genuine timing flake, not a resize bug (it
  // passes isolated and on retry). A real regression still fails both
  // attempts, so this masks flakes without hiding breakage.
  retries: 1,
  globalSetup: './e2e/global-setup.ts',
  webServer: {
    command: 'cd .. && go build -tags server -o bin/mill-server . && ./bin/mill-server',
    url: 'http://localhost:8080/health',
    // NEVER reuse a server something else started: three separate
    // incidents of the suite silently running against the wrong
    // process's data (once against the REAL desktop store -- a bare
    // mill-server without the MILL_* env was listening and the health
    // check can't tell servers apart, since Wails' asset server answers
    // any path). With reuse off, a rogue process holding the port is a
    // loud bind failure instead of a silent wrong-data run; the
    // isolation guard in global-setup.ts is the second layer.
    reuseExistingServer: false,
    timeout: 60_000,
    // Points CompositionService's persistence (main.go) at a throwaway
    // file instead of the real ~/Library/Application Support/mill/
    // settings.json -- otherwise this suite's composed/deleted test
    // workflows would write into the same file the real desktop dev app
    // reads its saved state from. MILL_EXECUTION_DB_PATH is the same
    // isolation for ExecutionService's DBOS-backed SQLite file
    // (docs/adr/0004), added alongside for the identical reason.
    env: {
      MILL_SETTINGS_PATH: '/tmp/mill-e2e-settings.json',
      MILL_EXECUTION_DB_PATH: '/tmp/mill-e2e-execution.db',
    },
  },
  use: {
    baseURL: 'http://localhost:8080',
  },
})
