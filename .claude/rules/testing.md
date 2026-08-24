# Testing discipline

No `paths` frontmatter — applies to fixing a bug in any file type, not one
language or directory.

**A bug confirmed via manual/live reproduction isn't done until that
reproduction becomes a permanent, committed test.** A one-off script or
manual check that confirms a fix and is then discarded is real
verification, but it doesn't shift left — the same bug class gets
manually re-discovered the next time something nearby changes. Commit the
reproduction as a test at the point you confirm the fix:

- A pure-function bug (off-by-one, collision check, formatting edge case)
  → a Vitest unit test (`*.test.ts`, co-located with the source file).
- An interaction or visual-state bug (hover/focus, drag-drop, an enabled/
  disabled control) → a Playwright case in the relevant `e2e/*.spec.ts`,
  asserting what the manual check asserted (a computed style, an element
  count, a text value) — not a screenshot diff unless the bug is
  fundamentally about layout/visual appearance.
- A Go bug → a `_test.go` case in the same package.

Doesn't apply if the bug was never actually reproduced live (caught by
code review, a type error, a lint rule) — the existing check already
covers it.

**E2e isolation is per-worker and per-run** (goal 0009): each Playwright
worker spawns its own `bin/mill-server` on its own port against fresh
`mkdtemp` settings/execution-db files, torn down at worker end
(`e2e/fixtures/server.ts`). Specs on the SHARED worker pool import
`test`/`expect` from that fixture, never from `@playwright/test`
directly. **Specs that spawn their own dedicated server are the
exception** and import `chromium`/`expect`/`test` from
`@playwright/test`, calling `spawnMillServer` themselves — see
`atlas-authoring.spec.ts` and `atlas-session-restore.spec.ts`. Stating
the rule without its exception has already sent one brief the wrong
way.
- Within-file cleanup discipline still applies — tests in one spec file
  share a worker/server, so delete what you create.
- Real-pasteboard tests take the clipboard lock
  (`e2e/fixtures/clipboardLock.ts`, `withClipboardLock`) — per-worker
  servers don't isolate the one real macOS clipboard; any test touching
  `capture-clipboard-*`/`apply-clipboard-write-*` serializes through it.
- `e2e/persistence.spec.ts` is the only spec allowed to bypass the worker
  fixture — its own server pair, one settings file, a restart in between,
  disjoint ports.
- Never spawn on the LaunchAgent's ports (8080 on the Tailscale interface,
  127.0.0.1:8090) — worker ranges are 9400+/9500+ (persistence:
  9600+/9650+).

**A UI feature isn't verified by narrow assertions alone — check it
against the actual task it's meant to satisfy.** Before calling a UI
change done, restate the underlying task in one sentence and check that
specific sentence, not just the elements the diff touched. Separately:
when a save/submit handler depends on a value computed just before it
fires, compute it into a local variable and pass it directly — don't
round-trip it through state first (React `setState` isn't synchronous).

**Every capability ships with a seeded example that exercises it — the
seed IS the proof.** A capability without a built-in example exercising
it end-to-end is invisible and unverifiable in the live app. When a
capability lands, add or extend a seeded example, prove it live, and
cover the seed with a real test (the Go suite runs the exact seeded
artifacts). Seeding is top-up with delete-tombstones (`reconcileBuiltIns`,
`configureservice_builtin.go`), so new examples reach existing instances
— never fresh-install-only. Changing an existing golden's content bumps
that golden's `SeedRevision` in the same change, or
`TestSeedFingerprints_MatchCommittedRecord` fails the build (see
`docs/goals/0037-seed-lifecycle.md`).

**Proof belongs at the right layer — a proof per capability, never a seed
forced onto everything.** Each layer proves what it's structurally best
at:

- **Seeds + their tests** — user-facing workflow capabilities: proof the
  feature works end-to-end through the real stack, and the live-app
  demonstration in one artifact.
- **Unit tests** — pure logic across its input range.
- **Integration/adapter tests** — adapters against real backing
  (DBOS/SQLite, keychain mock, in-memory MCP transports).
- **Interaction e2e** — presentation/interaction states data can't express
  (hover, drag, truncation, pointer-events).
- **Smoke/liveness** — app-level boot + advisory external liveness,
  non-blocking.
- **Real-webview engine parity** (`scripts/webview-bridge-smoke.sh`,
  `internal/webviewbridgesmoke`, goal 0097) — a scripted check registry
  driven over Wails3's own `-tags mcp` control bridge against the real
  desktop window, catching engine-behavior divergence (focus/selection/
  rendering) between macOS's real WKWebView and the Chromium-based suite
  above. Non-required/informational; runs local only, not in CI
  (`.github/workflows/webview-smoke.yml` is scheduled/manual-dispatch
  only — goal 0134 has the full trail on why it can't run on a hosted
  runner). DoR corollary: a feature whose interaction contract depends on
  engine-level semantics (focus, selection, scroll-reveal, caret) names at
  DoR whether it gets a smoke-registry check — "wired" or "deliberately
  not, because …" — never silence.
- **Manual-only registry** — OS-bound checks, listed explicitly with
  reasons, never silently absent (goal 0010's enforcement):
  - **Away-attention dock bounce** (`dockBounceFn`,
    `settingsservice_attention.go`) — the notify adapter's cgo send
    aborts headless; verify desktop-mode by parking an approval while
    unfocused.
  - **Menu-accelerator suspension during hotkey recording**
    (`settingsservice_menu.go`) — NSMenu's key-equivalent interception
    only exists in a real window; verify by arming a hotkey recorder,
    pressing ⌘⇧W / ⌘W / ⌘Q (each must be captured as a combo, never
    close/quit), then Escape/blur out and confirming accelerators work
    again.
  - **Dev-loop timing** (`BuildIdentityBadge`'s amber `DEV · go-stale`
    state, `isGoSourceStale`) — CI has no live file watcher; verify via
    `.claude/skills/run-mill` by wedging a `wails3 dev` rebuild and
    confirming the badge flips.
  - **Release-channel self-update** (goal 0082) — verify after the next
    tagged release, on a release-installed copy: Check for updates →
    Update now → Restart Mill, confirm the new version string.
  - **Multi-select box-drag synthesis** (goal 0081) — React Flow's
    pointermove delta sampling coalesces synthesized moves; verify by
    shift-dragging around 2+ cards desktop-mode.
  - **apply-notify's real banner** (goal 0114) — an actual notification
    banner is OS-bound (signed-bundle handshake); verify by running the
    seeded Clipboard→Markdown workflow via its hotkey while another app is
    focused and confirming the banner.
  - **App archetype: closing the last window must NOT quit Mill**
    (goal 0188) — `Mac.ActivationPolicy` is Regular and
    `ApplicationShouldTerminateAfterLastWindowClosed` is false, which no
    headless check can observe (server mode has no AppKit delegate at
    all). Verify on an installed build: close the main window with ⌘W
    and confirm Mill is still running and reachable from the tray;
    reopen it from the tray; then quit deliberately from the tray's Quit
    item and confirm the process actually exits. The flag composes
    lethally with any path that empties the screen — it terminated the
    app on a background summon, and once before via a window-closing
    accelerator during hotkey recording.
  - **Summon from a background app** (goals 0151, 0182, 0188) — the real kill
    chain (hotkey → activation → HideOnFocusLost → the main-window
    restore) needs a real macOS activation dance; verify on an installed
    build with Accessibility granted, main window already open in the
    background (a different app frontmost): hotkey from the other app —
    confirm the panel appears, Mill's main window does NOT flash into
    view alongside it (goal 0035), and the process survives (no
    SIGTRAP); dismiss via Escape, then again via click-away, then again
    via pressing the hotkey a second time — for each path, confirm
    neither Mill nor the previously-open main window vanishes from the
    app switcher/dock, and focus returns to the app you summoned from;
    finally reactivate Mill (dock click or Cmd+Tab) and confirm the main
    window is back, right where it was before the summon.
  - **Native file-drop delivery** (goal 0081 A3) — verify by dragging a
    `.md` file from Finder onto the running app and confirming the card
    lands with the real path.
  - **Companion panel against a real local model** (goal 0101) — verify
    desktop-mode with Ollama running: judge token-by-token
    responsiveness and whether replies parse into intended proposals
    often enough to be useful.
  - **MCP address editable/save/validate path** (goal 0116) — every e2e
    worker sets `MILL_MCP_ADDR` for port isolation, so an env override is
    structurally always active in the shared pool; verify desktop-mode
    (no override set) by entering an address in Settings (confirm the
    restart note), then a malformed one (confirm the validation message).
  - **Signing identity survives an update** (goal 0158) — real trust-
    settings state is machine-specific; verify by granting Accessibility
    once, taking two consecutive beta updates, and confirming the summon
    hotkey still registers with no new permission prompt.
  - **The real browser-tab approval notification** (goal 0132 slice A) —
    requires a real granted browser permission and a real OS compositor;
    verify via a server-mode instance reached from a real browser tab:
    enable notifications in Settings > Remote access, park an approval
    from another tab/device, switch away, confirm a system notification
    titled "Approval needed" appears, and clicking it lands on Review.
  - **The real Android ntfy delivery** (goal 0132 slice B) — the ntfy
    wire protocol reaching a real Android device is OS/vendor-app-bound;
    verify by installing the ntfy Android app, subscribing to a paired
    device's URL, parking an approval, confirming the phone receives it
    backgrounded, and tapping lands on Review.

**Tests drive user primitives, not synthetic events.** An interaction
test reaches behavior through the same primitives a user has — real
pointer presses and wheel (`click`, `mouse.wheel`), real key presses,
focus acquired by clicking or tabbing — never `dispatchEvent`,
programmatic `.focus()`/`.blur()`, or direct style/DOM mutation, except
as a last-resort escape hatch carrying a same-line comment naming why no
user primitive can reach the state.

## Testing maturity: gates, thresholds, flake protocol (goal 0080)

- **Coverage is measured and ratcheted, never aspirational.** Vitest runs
  `--coverage` scoped to hand-written `src/` (bindings exempt); thresholds
  in `vite.config.ts` are INTEGER floors raised manually in the same
  commit that raises real coverage. Go: every gate run produces a
  coverprofile checked by `scripts/check-go-coverage.sh` (floor committed
  in the script, raised in the same commit as real coverage). Unit floors
  measure the unit layer only — components are proven in e2e.
- **Diagnostics**: `trace: 'on-first-retry'`, `screenshot:
  'only-on-failure'`; CI retries 2 / local 1. A flake's first CI
  recurrence ships a trace.zip in the failure artifact — read it before
  theorizing.
- **The flake protocol**: a test observed flaking twice either gets FIXED
  or enters `frontend/e2e/QUARANTINE.md` with class, entered/review dates,
  and notes. Retry-passing is never a fix.
- **Interaction helpers live in `e2e/fixtures/`, not per-spec.** A helper
  used by 2+ spec files MUST be promoted. Standing helpers: the
  per-worker server, `withClipboardLock`, `clickCanvasNode`,
  `atlasCards`/`atlasPage`, `waitForViewportStable` + percentage-position
  clicks.
- **Assertion style**: web-first `expect(...)` retrying assertions over
  one-shot `boundingBox()` sampling after anything animated — poll
  geometry (`expect.poll`) or wait for transform stability first. New
  `waitForTimeout` calls need a same-line comment justifying why no
  observable condition exists.
- **Considered and rejected, with revisit triggers**: @testing-library
  component layer (revisit if e2e wall time forces shard growth past
  CI's 15-minute cap); Playwright code-coverage collection; octocov-style
  coverage actions.

## Quality gates: duplication + cognitive complexity (goal 0109)

- **Duplication (`dupl` @ 150, repo-wide)**: existing clusters are
  deliberate and excluded BY NAME — test twins (`_test.go`), the
  per-entity seed/CRUD shape in `configuresvc/`, and
  `atlasservice_builtin.go`. New duplication anywhere else fails the
  build; exclusions are named files/families with recorded reasons, never
  a threshold raise.
- **Cognitive complexity (`gocognit` @ 15, NEW/CHANGED code only)**:
  legacy production functions over threshold are grandfathered (burn-down
  list in the goal file) via `--enable-only gocognit
  --new-from-merge-base=origin/main` (lefthook `gocognit-new` + a CI step
  with `fetch-depth: 0`). Touching a legacy offender means paying its
  complexity down or consciously splitting the change.
- **eslint-plugin-sonarjs** (`frontend/eslint.config.js`):
  `sonarjs/cognitive-complexity` @ 15, `no-duplicated-branches`, and
  `no-identical-functions` run in the same `eslint` job. Still deferred:
  the diff-cover changed-lines coverage gate.
- **A repo-wide cross-file clone detector (jscpd or equivalent) was
  evaluated and rejected** for goal 0167's Configure-chrome dedup: total
  duplication was already low and diffuse, not concentrated in the
  pattern the goal targeted. Revisit if a future page is found
  hand-rolling Configure chrome again despite the shared component
  existing.

## Shared-pool vs dedicated e2e servers — declare it up front

A spec whose assertions read GLOBAL app state that other tests can write
(queue/filter contents, review history, session state, exact counts over
seeded collections) runs on a DEDICATED server pair — per-test spawn, own
port constants in `fixtures/server.ts` with a reasoning comment. The
shared worker pool is for specs whose assertions are scoped to entities
they create and delete themselves. Decide this when the spec is WRITTEN,
name it in its header comment. No test may depend on state left by an
EARLIER test, same file included — a test that needs history seeds it
inline.

## UI changes ship with a reviewed screenshot

Every UI-touching change gets a screenshot of the changed state (the
builder takes it; server-mode + Playwright is enough) reviewed against
the design contract BEFORE the PR opens — assertions prove elements
exist, the screenshot is where "green but visually wrong" gets caught.
This extends the "restate the task, not the elements" rule with a
concrete artifact.
