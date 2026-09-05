# Testing discipline

No `paths` frontmatter — applies to any file type or language.

**A bug confirmed via manual/live reproduction isn't done until that
reproduction becomes a permanent, committed test.** A one-off check
that's discarded doesn't shift left. Commit the reproduction as a test
when you confirm the fix:
- Pure-function bug → a Vitest unit test (`*.test.ts`, co-located).
- Interaction/visual-state bug → a Playwright case in `e2e/*.spec.ts`,
  asserting what the manual check asserted — not a screenshot diff
  unless the bug is fundamentally about layout.
- Go bug → a `_test.go` case in the same package.

Not for bugs never reproduced live (review, type error, lint).

**E2e isolation is per-worker and per-run** (goal 0009): each Playwright
worker spawns its own `bin/mill-server` on fresh `mkdtemp` files, torn
down at end (`e2e/fixtures/server.ts`). Shared-pool specs import
`test`/`expect` from that fixture, never `@playwright/test` directly.
**Specs with their own dedicated server** call `spawnMillServer`
themselves (`atlas-authoring.spec.ts`, `atlas-session-restore.spec.ts`).
- Within-file cleanup discipline applies — delete what you create.
- Tests/e2e default to memory (`MILL_CLIPBOARD=memory`); a real-pasteboard test spawns `host` under the lock (`withClipboardLock`).
- `e2e/persistence.spec.ts` is the only spec allowed its own server pair.
- Never spawn on the LaunchAgent's ports (8080 Tailscale, 127.0.0.1:8090)
  — worker ranges 9400+/9500+ (persistence 9600+/9650+).
- Local Playwright runs take a machine-wide slot lock
  (`fixtures/e2eSlotLock.ts`), waiting ≤45 min; CI bypasses it.

**A UI feature isn't verified by narrow assertions alone.** Restate the
underlying task in one sentence and check that, not the elements the
diff touched. A save/submit handler depending on a value computed just before it
fires should pass it directly, not round-trip through state
(`setState` isn't synchronous).

**Every capability ships with a seeded example that exercises it — the
seed IS the proof.** Seeding is top-up with delete-tombstones
(`reconcileBuiltIns`) — never fresh-install-only. Changing a golden's
content bumps its `SeedRevision`, or
`TestSeedFingerprints_MatchCommittedRecord` fails the build.

**Proof belongs at the right layer** — each proves what it's best at:
- **Seeds + their tests** — end-to-end proof through the real stack.
- **Unit tests** — pure logic across its input range.
- **Integration/adapter tests** — adapters against real backing.
- **Interaction e2e** — states data can't express (hover, drag,
  truncation, pointer-events).
- **Smoke/liveness** — app-level boot, non-blocking.
- **Real-webview engine parity** (`scripts/webview-bridge-smoke.sh`,
  goal 0097) — catches engine divergence between real WKWebView and the
  Chromium-based suite. Non-required, local-only. DoR corollary: a
  feature depending on engine-level semantics names whether it gets a
  smoke-registry check.
- **Manual-only registry** — OS-bound checks, listed with reasons, never
  silently absent (goal 0010); lives in the `manual-checks` skill.

**Tests drive user primitives, not synthetic events** — real pointer
presses, wheel, key presses, focus via clicking/tabbing, never
`dispatchEvent` or programmatic `.focus()`/`.blur()`, except as a last
resort carrying a same-line comment naming why.

## Testing maturity: gates, thresholds, flake protocol (goal 0080)

- **Coverage is ratcheted, never aspirational.** Vitest `--coverage`
  scoped to `src/`; thresholds in `vite.config.ts` are INTEGER floors
  raised with real coverage. Go: `scripts/check-go-coverage.sh`.
- **Diagnostics**: `trace: 'on-first-retry'`, screenshot on failure; CI
  retries 2/local 1; read the first flake's trace.zip.
- **CI-only flakes are chased locally under CPU throttle**:
  `E2E_CPU_THROTTLE=4 npx playwright test <spec> --retries=0
  --repeat-each=3` reproduces a load race, else look elsewhere.
- **CI shards run one worker each** (`fullyParallel` in CI only) — a
  file needing order declares `test.describe.configure({ mode:
  'serial' })`.
- **The flake protocol**: flaking twice → FIXED or entered in
  `frontend/e2e/QUARANTINE.md`. Retry-passing is never a fix; same
  two-strikes shape governs `defect_class` and Go tests.
- **Interaction helpers live in `e2e/fixtures/`** — used by 2+ files
  MUST be promoted: the per-worker server, `withClipboardLock`,
  `clickCanvasNode`, `atlasCards`/`atlasPage`, `waitForViewportStable`,
  `gotoAppReady`/`waitForAppReady`.
- **A shortcut-first test calls `gotoAppReady`** (`fixtures/appReady.ts`),
  never bare `page.goto`: the app mounts after an async plugin-load
  gate, so `goto` resolving isn't mount.
- **Seeded-content on the landing board**: "Board gallery" is the
  permanent home for seeded objects, never new root cards. Scope
  locators via `nonSeededBoardObjectWrapper`; no fixed-pixel placements.
- Never pass a needle with its own `.react-flow__node:not(...)`
  ancestor clause into `filter({has})`: it re-queries per candidate,
  failing as a silent zero-match.
- **Assertion style**: prefer retrying `expect(...)` over
  `boundingBox()` after anything animated; a new `waitForTimeout` needs
  a same-line reason; actions time out at 15 s (`actionTimeout`),
  failing with the locator, not the 90 s budget.

## Quality gates: duplication + cognitive complexity (goal 0109)

- **Duplication (`dupl` @ 150, repo-wide)**: clusters excluded BY NAME
  (test twins, `configuresvc/`, `atlasservice_builtin.go`).
- **Cognitive complexity (`gocognit` @ 15, NEW/CHANGED code only)**:
  legacy offenders grandfathered (burn-down list in the goal file).
- **eslint-plugin-sonarjs**: `cognitive-complexity` @ 15,
  `no-duplicated-branches`, `no-identical-functions`.

## Shared-pool vs dedicated e2e servers — declare it up front

A spec reading GLOBAL app state (queue/filter contents, review history,
seeded-collection counts) runs on a DEDICATED server pair, named in its
header comment. Shared pool is for specs scoped to entities they create
and delete themselves. No test may depend on state an earlier test left — seed it inline.

## UI changes ship with a reviewed screenshot

Every UI-touching change gets a screenshot of the changed state,
reviewed against the design contract before the PR opens — where
"green but visually wrong" gets caught.
