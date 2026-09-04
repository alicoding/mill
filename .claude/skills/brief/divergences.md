# Where this project diverges from the obvious default

The reusable list goal 0192 requires: each entry is "the obvious
answer is X; here it is Y; because Z." Copy relevant entries into
briefs verbatim. Add new entries the moment a dispatch exposes one —
this file is the record, a brief is a projection of it.

## Product model

- Obvious: canvas apps have a board lock. Here: Mill has NO board
  lock — never write it into a constraint (it was once invented from
  a screenshot).
- Obvious: everything on a board is a card/entity. Here: board
  OBJECTS (shape/ink/image/table/diagram/sheet) are a separate noun
  from cards; capture defaulting into a card is a named defect class
  (card-default-capture).
- Obvious: undo is per-widget/component state. Here: ONE actor-scoped
  undo journal behind every board mutation door (ADR-0044); tools
  never own undo.
- Obvious: a durable-execution engine recovers every parked run on
  restart. Here: recovery is gated on the engine's application version,
  which Mill pins to `executionsvc.WorkflowCodeVersion`; a run stamped
  with any other version is reconciled to Interrupted at startup, never
  recovered (goal 0329).
- Obvious: buttons own onClick handlers. Here: the command is the
  atom — buttons run `findCommand(id)?.run()`; enablement lives in
  `Command.enabled`, never as a silent inline guard (goal 0222).
- Obvious: apps quit when the last window closes. Here:
  ActivationPolicy Regular + ApplicationShouldTerminateAfterLastWindowClosed
  false — Mill lives past its windows (goal 0188's P0).
- Obvious: a Settings toggle may implement a feature. Here: Settings
  configures the kernel only; side effects arrive as composition
  (ADR-0035).
- Obvious: file-backed content gets bespoke wiring per type. Here:
  `fileBacked: true` in the noun registry + one shared watch +
  `object.openInDefaultApp` (goal 0232) — one declaration, no new
  watch or command code.

- Obvious: a nice-to-have found mid-build goes to a follow-up. Here:
  a gap against a CONFIRMED precedent is never deferred by an agent —
  it is reported back and built in the same goal (CLAUDE.md Research
  step); "follow-up" is not a word an agent's report may use for it.

## Testing harness

- Obvious: import test/expect from @playwright/test. Here: shared-
  pool specs import from `e2e/fixtures/server.ts`; only dedicated-
  server specs use @playwright/test directly (testing.md names the
  exceptions).
- Obvious: click a toolbar button by testid. Here: ALWAYS
  `openToolbarAction(page, testid)` — row buttons overflow into an
  ActionBar menu nondeterministically (the #464 TOCTOU incident); a
  CI gate (`toolbar-action-testids`) enforces this.
- Obvious: a test may end once its assertion passes. Here: a test
  that fired a real workflow run waits for the run's TERMINAL status
  before returning, or cleanup closes the DB under the live run
  (QUARANTINE.md's live-run class, #459/#466).
- Obvious: seeds are inert background. Here: seeded content on the
  landing board changes fitView extent and breaks fixed-pixel specs
  wholesale (goal 0223's park record); scope locators via
  `nonSeededBoardObjects`; do not add landing-board seeds casually.
- Obvious: the native drop gesture is testable. Here: it is not
  (server-mode Playwright is not a WebviewWindow) — route decisions
  are Vitest-tested; results land via the CreateBoardObject RPC
  escape hatch (testing.md).

## Operations (the standing block for every builder brief)

- Your worktree is your world: never write outside it; `cd` does not
  persist across Bash calls — use absolute paths (a stray file has
  landed in the main checkout twice this way).
- Obvious: revert the live tree to take a "before" screenshot. Here: a
  "before" comes from a THROWAWAY worktree at the explicit base commit;
  `git checkout <ref> -- <path>` in a builder's working tree is banned
  — worktrees share one `.git`, so it resolves against the CURRENT ref
  and overwrites tracked edits (goal 0327's near-miss).
- E2e slot: before ANY Playwright run,
  `ps -eo command | grep -E "chrome-headless-shell|e2e/.build/mill-server" | grep -v grep`
  must be empty. Never match "playwright test" (it matches wait
  loops — caused a livelock).
- Poll in place: background-run completion notifications are LOST.
  Never stop a turn to "wait for the monitor" — poll the run's own
  output with a bounded loop inside one Bash call, then deliver in
  the same turn.
- The nested `docs/` repo: shared physical path, orchestrator-
  committed — and for worktree-isolated agents it is now HARD-BLOCKED
  entirely (the sandbox refuses even plain-file writes outside the
  worktree; confirmed by two agents in one evening). The working
  pattern: the agent DRAFTS its docs edits (SPEC.md paragraph, goal
  frontmatter/record, BACKLOG line) VERBATIM in its final report,
  each labeled with the target path, and the orchestrator applies
  them at close. Briefs must ask for drafts, never for writes.
- PR truth: after `gh pr create`, verify with
  `gh pr view <n> --json number,state` and report that output — one
  agent reported a PR that was never created.
- Never: `pkill -f` / `killall` (kill only your own PIDs — a pkill
  once took down the production server), force-push, history
  rewrites.
- Lefthook Go gates can fail transiently while `task dev` rebuilds —
  rerun once before diagnosing.
