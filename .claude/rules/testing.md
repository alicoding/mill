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
- **Manual-only registry** — OS-bound checks (hotkey delivery, real
  clipboard, tray) listed explicitly with reasons, never silently
  absent (see goal 0010's enforcement).
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

From the UX point of view the seed layer stays privileged — it's the
one a human can SEE working — but correctness under change belongs to
the other layers, and every bug-repro still becomes a committed test
at whichever layer fits (the rule at the top of this file).
