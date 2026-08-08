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
