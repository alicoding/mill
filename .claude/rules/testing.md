# Testing discipline

No `paths` frontmatter — applies to fixing a bug in any file type, not one
language or directory.

**A bug confirmed via manual/live reproduction isn't done until that
reproduction becomes a permanent, committed test.** A one-off check
that's discarded doesn't shift left. Commit the reproduction as a test
at the point you confirm the fix:
- Pure-function bug → a Vitest unit test (`*.test.ts`, co-located).
- Interaction/visual-state bug → a Playwright case in `e2e/*.spec.ts`,
  asserting what the manual check asserted — not a screenshot diff
  unless the bug is fundamentally about layout.
- Go bug → a `_test.go` case in the same package.

Doesn't apply if never reproduced live (caught by review, a type error,
a lint rule).

**E2e isolation is per-worker and per-run** (goal 0009): each Playwright
worker spawns its own `bin/mill-server` on fresh `mkdtemp` files, torn
down at worker end (`e2e/fixtures/server.ts`). Shared-pool specs import
`test`/`expect` from that fixture, never `@playwright/test` directly.
**Specs with their own dedicated server** call `spawnMillServer`
themselves (`atlas-authoring.spec.ts`, `atlas-session-restore.spec.ts`).
- Within-file cleanup discipline applies — delete what you create.
- Real-pasteboard tests take the clipboard lock (`withClipboardLock`).
- `e2e/persistence.spec.ts` is the only spec allowed its own server pair.
- Never spawn on the LaunchAgent's ports (8080 Tailscale, 127.0.0.1:8090)
  — worker ranges 9400+/9500+ (persistence 9600+/9650+).

**A UI feature isn't verified by narrow assertions alone.** Restate the
underlying task in one sentence and check that, not just the elements
the diff touched. A save/submit handler that depends on a value
computed just before it fires should pass it directly — not round-trip
through state first (`setState` isn't synchronous).

**Every capability ships with a seeded example that exercises it — the
seed IS the proof.** Add or extend one, prove it live, cover it with a
real test. Seeding is top-up with delete-tombstones
(`reconcileBuiltIns`) — never fresh-install-only. Changing a golden's
content bumps its `SeedRevision`, or
`TestSeedFingerprints_MatchCommittedRecord` fails the build.

**Proof belongs at the right layer.** Each layer proves what it's
structurally best at:
- **Seeds + their tests** — end-to-end proof through the real stack.
- **Unit tests** — pure logic across its input range.
- **Integration/adapter tests** — adapters against real backing.
- **Interaction e2e** — states data can't express (hover, drag,
  truncation, pointer-events).
- **Smoke/liveness** — app-level boot, non-blocking.
- **Real-webview engine parity** (`scripts/webview-bridge-smoke.sh`,
  goal 0097) — catches engine divergence between real WKWebView and the
  Chromium-based suite. Non-required, local only. DoR corollary: a
  feature depending on engine-level semantics names at DoR whether it
  gets a smoke-registry check.
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
  retries 2 / local 1 — read the first flake's trace.zip first.
- **CI-only flakes are chased locally under CPU throttle, never by
  rerunning CI**: `E2E_CPU_THROTTLE=4 npx playwright test <spec>
  --retries=0 --repeat-each=3` — reproduces → a load race; doesn't →
  look elsewhere.
- **CI shards run one worker each** (`fullyParallel` on in CI only) — a
  file needing order declares `test.describe.configure({ mode:
  'serial' })`.
- **The flake protocol**: flaking twice → FIXED or entered in
  `frontend/e2e/QUARANTINE.md`. Retry-passing is never a fix; same
  two-strikes shape governs `defect_class` repo-wide and Go tests.
- **Interaction helpers live in `e2e/fixtures/`** — used by 2+ files
  MUST be promoted: the per-worker server, `withClipboardLock`,
  `clickCanvasNode`, `atlasCards`/`atlasPage`, `waitForViewportStable`,
  `gotoAppReady`/`waitForAppReady`.
- **A shortcut-first test calls `gotoAppReady`** (`fixtures/appReady.ts`),
  never bare `page.goto`: the app mounts after an async plugin-load gate
  (main.tsx's `bootstrap()`), so `goto` resolving is not mount.
- **Seeded-content on the landing board**: "Board gallery" is the
  PERMANENT home for seeded example objects — never new root cards.
  Scope locators via `nonSeededBoardObjectWrapper`; no fixed-pixel
  placements. Never pass a needle carrying its own
  `.react-flow__node:not(...)` ancestor clause into `filter({has})`:
  Playwright re-queries the needle inside each candidate, so the
  failure is a silent zero-match.
- **Assertion style**: web-first retrying `expect(...)` over one-shot
  `boundingBox()` after anything animated; new `waitForTimeout` needs a
  same-line justifying comment.

## Quality gates: duplication + cognitive complexity (goal 0109)

- **Duplication (`dupl` @ 150, repo-wide)**: deliberate clusters
  excluded BY NAME (test twins, `configuresvc/`, `atlasservice_builtin.go`).
- **Cognitive complexity (`gocognit` @ 15, NEW/CHANGED code only)**:
  legacy offenders grandfathered (burn-down list in the goal file).
- **eslint-plugin-sonarjs**: `cognitive-complexity` @ 15,
  `no-duplicated-branches`, `no-identical-functions`.

## Shared-pool vs dedicated e2e servers — declare it up front

A spec reading GLOBAL app state (queue/filter contents, review history,
seeded-collection counts) runs on a DEDICATED server pair, named in its
header comment. Shared pool is for specs scoped to entities they create
and delete themselves. No test may depend on state left by an earlier
test — seed history inline.

## UI changes ship with a reviewed screenshot

Every UI-touching change gets a screenshot of the changed state
reviewed against the design contract BEFORE the PR opens — the
screenshot is where "green but visually wrong" gets caught.
