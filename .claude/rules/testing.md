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

**A Playwright e2e test that creates a named, persisted entity
(a workflow, a Connector, a List, an MCP Server, anything that survives
past the test via `MILL_SETTINGS_PATH`) must delete it before the test
ends.** `playwright.config.ts` points every e2e run at one shared,
reused settings file (`/tmp/mill-e2e-settings.json`, not reset between
spec files or between repeated full-suite runs) specifically so
composed test data persists across a run the way real user data would —
but that means anything created and not cleaned up accumulates
duplicate rows across every future run of the suite, forever, until
someone notices. Concretely hit: a new spec created connectors by label
and asserted on `getByTestId('connector-row').filter({ hasText: ... })`
with no cleanup — passed once in isolation, then failed with a
"resolved to 4 elements" strict-mode violation the next time the full
suite ran, because three earlier runs' leftover connectors were still
sitting in the shared settings file. Every other e2e spec in this repo
already deletes what it creates (see `composition.spec.ts`'s
create-then-delete workflow tests); this is that same discipline made
explicit so it isn't independently rediscovered per spec file. Verify a
new spec's cleanup actually works by running the full suite twice in a
row before trusting it, not just once — the bug only surfaces on the
second run.

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
