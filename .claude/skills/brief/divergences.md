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
- Obvious: `kSecAttrAccessControl` gates a keychain item behind Touch
  ID. Here: only in the data-protection keychain, which needs a Team ID
  entitlement; Mill is self-signed, so Touch ID is a LocalAuthentication
  gate in FRONT of a plain login-keychain item, and the key stays
  readable by any process running as the user (goal 0330; SPEC `OPEN`
  item for the Team ID).
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
- Obvious: press `ControlOrMeta+<key>` for a shortcut. Here: a MILL
  shortcut is pressed as `Meta+<key>` — Playwright resolves
  `ControlOrMeta` on the browser's platform, so the Linux CI runner sends
  Ctrl and Mill's keymap (`shared/keybinding.ts`) never matches; only the
  browser's own copy/paste/select-all are platform-relative (#699).
- Obvious: a click focuses the grid. Here: never force focus on
  `pointerdown` in `ListGridGlide` — the library's own mousedown arms the
  auto-select suppression; forcing focus first pre-selects a cell and a
  first click opens an editor (#699). Focus on pointerup, skipped when
  focus is already inside the host.
- Obvious: probe `isVisible()` after `page.goto` to decide a branch. Here:
  never — `goto` resolving is not mount (the plugin-load gate); branch on
  what the test already knows (viewport size) and let `.click()`
  auto-wait (#691's toolbar-overflow race).
- Obvious: the native drop gesture is testable. Here: it is not
  (server-mode Playwright is not a WebviewWindow) — route decisions
  are Vitest-tested; results land via the CreateBoardObject RPC
  escape hatch (testing.md).
- Obvious: escape the widget, then press the shortcut. Here: press it
  with the widget focused — a test that leaves the widget before the
  gesture proves nothing about the gesture from inside it (#710: the
  grid swallowed every keydown and the escape helper could not observe
  focus).

## Operations (the standing block for every builder brief)

- **Poll in place: background-run completion notifications are LOST.
  Never run a command with `run_in_background`; never end a turn waiting
  on one — run it in the foreground (timeout up to 600000) and, if it
  outlives one call, poll its output with a bounded `sleep 30` loop in
  the NEXT foreground call, repeating in the same turn until done.**
  (Five builders in one day still stopped to wait for a notification.)
- A lefthook commit can outlive one foreground Bash call (the full
  suite plus the gate-lock wait exceeds 600 s). Launch it detached
  INSIDE a foreground call (`nohup git commit -F msg.txt > commit.log
  2>&1 &`, never the tool's `run_in_background`), then poll
  `commit.log`/`git log -1` in bounded `sleep 30` loops in the next
  calls (macOS has no `setsid`).
- Your worktree is your world: never write outside it; `cd` does not
  persist across Bash calls — use absolute paths (a stray file has
  landed in the main checkout twice this way).
- Obvious: revert the live tree to take a "before" screenshot. Here: a
  "before" comes from a THROWAWAY worktree at the explicit base commit;
  `git checkout <ref> -- <path>` in a builder's working tree is banned
  — worktrees share one `.git`, so it resolves against the CURRENT ref
  and overwrites tracked edits (goal 0327's near-miss).
- E2e slot: run Playwright normally — the harness serializes suites
  with a machine-wide lock (`e2e/fixtures/e2eSlotLock.ts`); never kill
  another suite's processes; a wait longer than 45 min is a report, not
  a bypass.
- The nested `docs/` repo: shared physical path, orchestrator-
  committed — and for worktree-isolated agents it is now HARD-BLOCKED
  entirely (the sandbox refuses even plain-file writes outside the
  worktree; confirmed by two agents in one evening). The working
  pattern: the agent DRAFTS its docs edits (SPEC.md paragraph, goal
  frontmatter/record, BACKLOG line) VERBATIM in its final report,
  each labeled with the target path, and the orchestrator applies
  them at close. Briefs must ask for drafts, never for writes.
- Obvious: `git stash` to set work aside during a conflicted merge.
  Here: never — stash drops `MERGE_HEAD`; commit first, resolve in
  place (goal 0339's builder lost a merge this way).
- Obvious: a green PR auto-merges on its own. Here: the main ruleset
  requires the branch UP TO DATE (ADR-0034 amendment; the merge queue
  is organization-only); after checks pass, `gh pr view <n> --json
  mergeStateStatus` reading `BEHIND` means `gh pr update-branch <n>`
  (or merge origin/main in — never rebase + force-push) and one more
  CI run before auto-merge completes.
- PR truth: after `gh pr create`, verify with
  `gh pr view <n> --json number,state` and report that output — one
  agent reported a PR that was never created.
- Never: `pkill -f` / `killall` (kill only your own PIDs — a pkill
  once took down the production server), force-push, history
  rewrites.
- Lefthook Go gates can fail transiently while `task dev` rebuilds —
  rerun once before diagnosing.
