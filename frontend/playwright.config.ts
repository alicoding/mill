import { defineConfig } from '@playwright/test'

// Drives Mill's own Wails3 server mode (see ../.claude/skills/run-mill/SKILL.md)
// instead of a plain frontend dev server -- real Go service bindings over
// HTTP, not a mock. Requires frontend/dist to already exist (go:embed) --
// same prerequisite as everything else in this repo.
export default defineConfig({
  testDir: './e2e',
  webServer: {
    command: 'cd .. && go build -tags server -o bin/mill-server . && ./bin/mill-server',
    url: 'http://localhost:8080/health',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    // Points CompositionService's persistence (main.go) at a throwaway
    // file instead of the real ~/Library/Application Support/mill/
    // settings.json -- otherwise this suite's composed/deleted test
    // workflows would write into the same file the real desktop dev app
    // reads its saved state from.
    env: { MILL_SETTINGS_PATH: '/tmp/mill-e2e-settings.json' },
  },
  use: {
    baseURL: 'http://localhost:8080',
  },
})
