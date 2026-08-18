# Testing discipline

No `paths` frontmatter deliberately — this applies to fixing a bug in
any file type, not one language or directory.

**A bug confirmed via manual/live reproduction isn't done until that
reproduction becomes a permanent, committed test.** Verifying a fix by
hovering an element, dragging a node, or running a one-off script and
reading the result, then discarding the script once it confirms the
fix — is real verification, but it doesn't shift left: the same bug
class just gets manually re-discovered next time something nearby
changes, paying the same investigation cost again. The reproduction
already exists at the moment you confirm the fix; committing it as a
test is close to free compared to re-deriving it later.

Concretely:

- A pure-function bug (a math/logic error like an off-by-one, a
  collision check, a formatting edge case) → a Vitest unit test
  (`*.test.ts`, co-located with the source file).
- An interaction or visual-state bug (hover/focus behavior, drag-drop,
  a control that should or shouldn't be enabled) → a Playwright case in
  the relevant `e2e/*.spec.ts`, asserting the same thing the manual
  check asserted (a computed style, an element count, a text value) —
  not a screenshot diff unless the bug is fundamentally about layout/
  visual appearance rather than a checkable property.
- A Go bug → a `_test.go` case in the same package, same principle.

This isn't "add tests for everything" — it's specifically about not
losing verification work that already happened. If a bug was never
actually reproduced live (caught by code review, a type error, a lint
rule), this doesn't apply; the existing check already covers it.

Real instance this came from: four bugs in one session (a canvas
node-drop collision, a duplicate-trigger-drop rejection, a disabled
palette item's hover background, a node-type-swap regression) were each
verified via a throwaway Playwright script, confirmed working, then
discarded — leaving zero permanent coverage for any of them. All four
were converted into committed test cases after the fact (SPEC.md §3);
this rule exists so that conversion happens as part of the fix, not as
a separate cleanup pass discovered later.

**E2e isolation is per-worker and per-run (goal 0009): each Playwright
worker spawns its own `bin/mill-server` on its own port against fresh
`mkdtemp` settings/execution-db files, torn down at worker end**
(`e2e/fixtures/server.ts` — every spec imports `test`/`expect` from
there, never from `@playwright/test` directly). Cross-run
contamination is structurally impossible now; the old
run-the-suite-twice verification instruction is retired. What still
holds:
- **Within-file cleanup discipline stays** — tests in one spec file
  share a worker/server, so a test that creates named entities and
  doesn't delete them can still break strict-mode selectors in later
  tests of the same file. Delete what you create.
- **Real-pasteboard tests must take the clipboard lock**
  (`e2e/fixtures/clipboardLock.ts`, `withClipboardLock`) — per-worker
  servers don't isolate the ONE real macOS clipboard; any test whose
  workflow touches `capture-clipboard-*`/`apply-clipboard-write-*`
  (including a new workflow's default starter) serializes through it.
- **Deliberate persistence stays proven once, explicitly** —
  `e2e/persistence.spec.ts` spawns its own server pair against one
  settings file with a restart in between; that's the only spec
  allowed to bypass the worker fixture, on its own disjoint ports.
- Never spawn on the LaunchAgent's ports (8080 on the Tailscale
  interface, 127.0.0.1:8090) — worker ranges are 9400+/9500+
  (persistence: 9600+/9650+).

**A UI feature isn't verified by narrow assertions alone — check it
against the actual task it's meant to satisfy.** Concretely hit: the
Configure → Integration connector form shipped with Headers/Base
URL/Auth fields and an "OpenAPI spec" textarea, each individually
covered by a passing Playwright assertion ("does this element exist,"
"does this value round-trip") — but no test, and no manual pass, ever
asked "can a user actually finish defining a connector's schema
without writing raw OpenAPI by hand," which was the real, larger gap
the user found by using the live app. Server-mode Playwright
(`run-mill`) and the real desktop app run identical Go/React code —
this was never a platform-parity bug — the miss was scope: assertions
proved the pieces existed, not that the feature did its job. Before
calling a UI change done, restate the underlying task in one sentence
("can someone define an operation's input/output fields without
touching JSON") and check that specific sentence, not just the
elements the diff touched. A second, distinct trap this same feature
also hit: an `onDraftChange(newValue)` immediately followed by a
`onSave()` read the *previous* render's stale state (React `setState`
isn't synchronous) — passed a quick manual click-through, failed the
first real e2e run all the way to a persisted save. When a save/submit
handler depends on a value computed just before it fires, compute it
into a local variable and pass it directly, don't round-trip it
through state first.

**Every capability ships with a seeded example that exercises it — the
seed IS the proof.** Direct user decision ("I don't have any real
data... every feature we build needs proof with a seeded example that
uses everything"): a capability without a built-in example exercising
it end-to-end is invisible and unverifiable in the live app. When a
capability lands, add or extend a seeded example (workflow,
HTTPRequest, ...) that uses it, prove it live, and cover the seed with
a real test (the Go suite runs the exact seeded artifacts — see
`TestSeededParentChildExample_TypedInputAndOutput_RunsEndToEnd`).
Seeding is top-up with delete-tombstones (`reconcileBuiltIns`,
`configureservice_builtin.go`), so new examples reach existing
instances — never fresh-install-only. Changing an existing golden's
content (not just adding a new one) needs its own discipline, CI-
enforced: bump that golden's `SeedRevision` in the same change, or
`TestSeedFingerprints_MatchCommittedRecord` (`internal/services/
seeding`) fails the build — see `docs/goals/0037-seed-lifecycle.md` for
the full reconcile/reset/restore design this protects.

**Refined by direct owner decision (2026-08-10): seeds are one layer,
not the universal proof — don't force the seed pattern onto
everything.** Follow the industry-standard layering, each proving what
it's structurally best at; the requirement is "a proof at the RIGHT
layer per capability," never "a seed per thing":

- **Seeds + their tests** — user-facing workflow capabilities: proof
  the feature exists and works end-to-end through the real stack, and
  the live-app demonstration in one artifact. The spine, applied where
  a runnable example is natural — never contrived to satisfy a rule.
- **Unit tests** — pure logic across its input range (ruleTranslate,
  findFreeDropPosition, resolveMCPArguments): the layer that catches
  edge-input bugs no single example ever will.
- **Integration/adapter tests** — adapters against real backing
  (DBOS/SQLite, keychain mock, in-memory MCP transports).
- **Interaction e2e** — presentation/interaction states data can't
  express (hover, drag, truncation, pointer-events regressions).
- **Smoke/liveness** — app-level boot + advisory external liveness
  (the seeded integrations' endpoints), non-blocking.
- **Real-webview engine parity** (`scripts/webview-bridge-smoke.sh`,
  `internal/webviewbridgesmoke`, goal 0097) — a scripted, named check
  registry driven over Wails3's own `-tags mcp` control bridge against
  the REAL desktop window, catching engine-behavior divergence
  (focus/selection/rendering classes) between macOS's real WKWebView
  and every other layer above, which all run Chromium. Exists because
  a real WebKit-only defect (a selection ring / focus-halo difference)
  shipped invisible to the whole Chromium-based suite. **Researched
  and rejected**: a Playwright `webkit`-project was the original
  premise, but primary sources showed Playwright's `webkit` build is
  patched WebKit-main that never attaches to an app's own embedded
  webview, and no macOS WebDriver exists for a third-party WKWebView
  at all — the OSS convergence for real parity is driving the actual
  embedded webview via an app bridge, which is what this layer does.
  Playwright's `webkit` browser stays installed as a local debugging
  probe only, never CI-badged as parity. Revisit trigger: grow the
  check registry when a WebKit-only bug escapes it, same discipline as
  the manual-only registry below.
  **CI status: non-required/informational; the launch failure was
  the harness's own liveness probe, now fixed.** Every "app process
  exited before the MCP bridge became reachable" failure (CI and
  local alike) traced to `procExited` calling `Process.Signal(nil)`:
  the Unix implementation type-asserts its argument to
  `syscall.Signal`, a nil interface fails that assertion, and the
  probe declared every perfectly-alive launch dead on its first
  poll. The earlier headless-windowing lead was never actually
  tested — the harness failed before the app could boot. With
  `syscall.Signal(0)` the local run connects and drives the real
  registry. **Calibrated (goal 0107): all six checks green, three
  consecutive local runs.** The registry now asserts the app's real
  three-window shape by NAME (main + quickpanel + approvalprompt;
  the main window carries an explicit `Name: "main"` in main.go for
  exactly this addressing), and every page-directed bridge call is
  window-scoped via `withWindow` — the bridge's `window` parameter
  defaults to "focused or first window", which with three windows
  was the root of every flip-flopping check and the missed badge.
  Second root cause, harness-repaired and upstream-worthy: the
  bridge's `call_bound_method` tool imports a SECOND runtime
  instance into the page (`await import('/wails/runtime.js')` in
  its own implementation), which re-registers
  `window._wails.dispatchWailsEvent` and permanently orphans the
  app bundle's event listeners — all live-sync (and the footer
  clock) dies at the first bound call. Every bound call in the
  harness therefore goes through `callBoundJSON`, which re-chains
  the captured app dispatcher (`captureAppDispatch` /
  `repairAppDispatch`, checks.go). This defect is bridge-client
  triggered only — a desktop build nobody drives over MCP never
  imports the second instance — but any future agent-drives-the-
  desktop-app work must reuse the same repair. CI job: stays wired,
  non-required, promote after a green track record on the
  calibrated registry.
- **Manual-only registry** — OS-bound checks (hotkey delivery, real
  clipboard, tray) listed explicitly with reasons, never silently
  absent (see goal 0010's enforcement). Non-seed instance: the
  away-attention dock bounce (`dockBounceFn`,
  `settingsservice_attention.go`) — only its nil-window guard is
  unit-testable (the notify adapter's cgo send aborts headless, so
  the full away branch can't run under `go test`); the real
  bounce-once-on-a-parked-approval behavior is OS-bound and
  CI-invisible — verify it desktop-mode by parking an approval while
  unfocused. Second non-seed instance: menu-accelerator suspension
  during hotkey recording (`SuspendMenuAccelerators`/
  `RestoreMenuAccelerators`, `settingsservice_menu.go`) — the
  reference-count logic is unit-tested
  (`settingsservice_menu_test.go`), but NSMenu's
  `performKeyEquivalent:` interception only exists in a real desktop
  window: verify desktop-mode by arming any hotkey recorder and
  pressing ⌘⇧W / ⌘W / ⌘Q (each must be captured as a combo, never
  close the window or quit), then Escape/blur out and confirm the
  menu accelerators work again.
- **Dev-loop timing checks** — a non-seed instance of the same manual-
  only discipline, outside goal 0010's seed/NodeType registry (that
  machinery is keyed to seeded artifacts; this isn't one). Goal 0029's
  BuildIdentityBadge third state (amber `DEV · go-stale`) depends on a
  real `wails3 dev` rebuild wedging or running slow — CI has no live
  file watcher or real Go recompile-and-relaunch cycle to reproduce
  that timing deterministically. The pure comparison logic
  (`isGoSourceStale`, `frontend/src/app/goLiveness.ts`) is unit-tested
  directly (`goLiveness.test.ts`); the full live behavior — an actually
  wedged watcher flipping the badge amber in a real window — stays a
  manual desktop-mode check (`.claude/skills/run-mill`), named here
  rather than silently absent.
- **Release-channel self-update** (goal 0082, `UpdatesSection` +
  `SettingsService.DownloadAndInstallUpdate`) — the refusal paths
  (source-channel guard, digest-mismatch fail-closed verification)
  are Go-tested, and both channels' UI renders under the
  `MILL_TEST_UPDATE_*` seams in e2e; the real download → SHA256SUMS
  verify → bundle swap → restart can only run against a genuine
  newer GitHub release from an installed release-channel build —
  verify after the next tagged release by clicking Check for
  updates → Update now → Restart Mill on a release-installed copy
  and confirming the new version string.
- **Multi-select box-drag SYNTHESIS** (goal 0081, `useAtlasSelection`
  + the selection-overlay context menu) — the box-drag gesture's
  synthesis is CI-invisible (React Flow's pointermove delta sampling
  coalesces synthesized moves; QUARANTINE.md's atlas-select-group
  entry has the full trail). Since goal 0092 the downstream chain
  (multi-selection → member right-click → Group into new area;
  Delete over a selection) IS CI-proven via the shift-click toggle
  test in the same spec file — what stays manual is only the
  box-drag gesture itself: shift-drag around 2+ cards desktop-mode
  and confirm the selection forms.
- **apply-notify's real banner** (goal 0114) — the step's config
  plumbing, attribute override, and error paths are unit-tested, and
  the seeded Clipboard → Markdown graph executes in tests via the
  server-mode best-effort mapping (unsupported ≠ failed) — but an
  actual notification banner appearing is OS-bound
  (UNUserNotificationCenter, signed-bundle handshake, same class as
  the dock bounce above): verify desktop-mode by running the seeded
  workflow via its hotkey while another app is focused and confirming
  the "Markdown is on your clipboard" banner.
- **Native file-drop delivery** (goal 0081 A3, `EnableFileDrop` +
  `WindowFilesDropped`) — the landing/derivation logic is Go-tested
  and the flow is e2e-proven at the service level, but a real OS
  drag from Finder onto the window only exists desktop-mode: verify
  by dragging a `.md` file onto the running app and confirming the
  card lands with the file's real path.

From the UX point of view the seed layer stays privileged — it's the
one a human can SEE working — but correctness under change belongs to
the other layers, and every bug-repro still becomes a committed test
at whichever layer fits (the rule at the top of this file).

## Testing maturity: gates, thresholds, flake protocol (goal 0080)

Owner-mandated after the audit found zero coverage signal, all
Playwright diagnostics off, and a ~16-test flake list living as
folklore in agent-brief prose. The standing rules:

- **Coverage is measured and ratcheted, never aspirational.** Vitest
  runs `--coverage` everywhere (`npm run test`), scoped to
  hand-written `src/` (bindings exempt, same reasoning as
  check-loc); thresholds live in vite.config.ts as
  INTEGER floors raised manually in the same commit that raises real
  coverage (a 2-decimal auto-ratchet was tried first and made every
  e2e-proven UI line a sub-0.1% commit failure — wrong for a layering
  that proves components in e2e). Go: every gate run produces a
  coverprofile checked by `scripts/check-go-coverage.sh` (floor
  committed in the script; raise it in the same commit that raises
  real coverage — the script nags when you're >1pt above). The unit
  floors measure the UNIT layer only: components are deliberately
  proven in e2e (the layering above), so ~13% TS statements at
  adoption is honest, not alarming — judge the ratchet's slope, not
  the absolute number against industry 80%-lore.
- **Diagnostics exist exactly when needed**: `trace:
  'on-first-retry'`, `screenshot: 'only-on-failure'`; CI retries 2 /
  local 1 (the local 1 masks one documented pointer-coalescing
  class; a real regression still fails both attempts). A flake's
  first CI recurrence therefore ships a trace.zip in the failure
  artifact — read it before theorizing.
- **The flake protocol** (replaces every "known flakes" prose list):
  a test observed flaking twice either gets FIXED or enters
  `frontend/e2e/QUARANTINE.md` with class, entered/review dates, and
  notes. Entries leave by fix or by review-date decision;
  retry-passing is never a fix. Agent briefs cite the register, not
  a pasted list.
- **Interaction helpers live in `e2e/fixtures/`, not per-spec.** A
  helper used by 2+ spec files MUST be promoted (the shared/-folder
  rule, applied to tests) — the audit found `workflowRow` copied 39
  times and the one animation-settle helper marooned in a single
  file while 23 files carried the race it fixes. Standing helpers:
  the per-worker server, `withClipboardLock`, `clickCanvasNode`,
  `atlasCards`/`atlasPage`, and (post burn-down)
  `waitForViewportStable` + percentage-position clicks.
- **Assertion style**: web-first `expect(...)` retrying assertions
  over one-shot `boundingBox()` sampling after anything animated —
  poll geometry (`expect.poll`) or wait for transform stability
  first. New `waitForTimeout` calls need a same-line comment
  justifying why no observable condition exists.
- **Considered and rejected, with revisit triggers**:
  @testing-library component layer (the pure-function + real-
  bindings-e2e layering keeps catching real bugs; revisit if e2e
  wall time forces shard growth past CI's 15-minute cap); Playwright
  code-coverage collection (heavy, low signal over per-test
  assertions); octocov-style coverage actions (a 15-line floor
  script suffices; no new CI dependency).

## Quality gates: duplication + cognitive complexity (goal 0109)

The SonarQube-class gates, wired measurement-first (a full read-only
run over the tree BEFORE thresholds were committed — hit lists in the
goal file), never aspiration-first:

- **Duplication (`dupl` @ 150, repo-wide)**: lands green because the
  only existing clusters are deliberate and excluded BY NAME — test
  twins (`_test.go`), the per-entity seed/CRUD shape in
  `configuresvc/`, and `atlasservice_builtin.go`. New duplication
  anywhere else fails the build. Anti-gaming: exclusions are named
  files/families with recorded reasons, never a threshold raise.
- **Cognitive complexity (`gocognit` @ 15, NEW/CHANGED code only)**:
  25 legacy production functions sit over the threshold (max 65 —
  burn-down list in the goal file), so the gate runs Sonar's own
  clean-as-you-code posture via `--enable-only gocognit
  --new-from-merge-base=origin/main` (lefthook `gocognit-new` + a CI
  step; the lint job's checkout carries `fetch-depth: 0` for the
  merge-base). Legacy refuses to rot further without failing today's
  build; touching a legacy offender means paying its complexity down
  or consciously splitting the change.
- **Deferred to the npm-deps landing** (lockfile-conflict avoidance,
  recorded in the goal file): eslint-plugin-sonarjs (TS cognitive
  complexity + duplicate-branch rules) and the diff-cover
  changed-lines coverage gate.

## Shared-pool vs dedicated e2e servers — declare it up front

A spec whose assertions read GLOBAL app state that other tests can
write — queue/filter contents, review history, session state, exact
counts over seeded collections — runs on a DEDICATED server pair
(the guardrail-authoring/guardrail-review pattern: per-test spawn,
own port constants in fixtures/server.ts with a reasoning comment).
The shared worker pool is for specs whose assertions are scoped to
entities they create and delete themselves. This is decided when the
spec is WRITTEN, named in its header comment — not discovered as a
CI-only cohabitation flake later (the class that bit twice on
2026-08-17: atlas session bleed, then guardrail's filter dropdown
depending on file-order history). Corollary: no test may depend on
state left by an EARLIER test, same file included — a test that
needs history seeds it inline.

## UI changes ship with a reviewed screenshot

Every UI-touching change gets a screenshot of the changed state
(the builder takes it; server-mode + Playwright is enough) reviewed
against the design contract BEFORE the PR opens — assertions prove
elements exist, the screenshot is where "green but visually wrong"
gets caught (the selection-invisibility and sticky-ring classes:
both pipeline-green, both caught by eyes). This extends the
existing "restate the task, not the elements" rule with a concrete
artifact; it replaces nothing.
