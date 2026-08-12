# 0015 — Summon quick-invoke: the palette that teaches you to skip it

## Goal
Owner-endorsed (2026-08-10) as the value mirror's companion (goal
0014): a command-palette quick-invoke — "super useful when you want a
quick trigger and don't remember which key, and it shows you that
next time you can do this instead," plus the standard personalization
pattern (frequently-used float up, pinned, configurable).

## Design direction
- **⌘K in-window palette** (industry-standard) built on Primer's
  `FilteredActionList` — already named in .claude/rules/frontend.md
  as "fits a command-palette-style picker," unused until now.
  **Superseded 2026-08-11**: the §3.7 OS summon hotkey no longer opens
  the main window INTO this palette — it now toggles a dedicated
  second floating window, the **Quick Panel**
  (`docs/adr/0033-quick-panel-second-window.md`), a Raycast/Alfred-
  style search-and-run surface separate from the main window entirely.
  This ⌘K palette is unchanged and still the right surface for
  *already being in Mill* (spans commands/tabs/workflows); the Quick
  Panel is the new surface for *not yet being in Mill*.
- Each row: workflow + its **trigger identity inline** — the
  assigned hotkey combo (the Raycast education loop: the palette is
  the on-ramp, the hotkey is the destination), armed state for
  schedule/watch, "callable" demoted. Enter = the same run semantics
  as the list-row Run (test kind; consistency over cleverness).
- Pending-review count surfaces in the palette (goal 0005 tie-in).
- **Frecency + pins**: frequency/recency ranking from local run
  history — THE SAME substrate as goal 0014's value mirror (one
  usage-stats capability feeds both; build it once). Pinned
  workflows float; personalization config lives with 0014's
  preferences (per-workflow minutes-saved, notification opt-ins).

## Sequencing
Pairs with 0014; the shared usage-stats read layer is the common
prerequisite — whichever of the two goals goes first builds it.

## Owner reinforcement (2026-08-10, live testing) — discoverability is THE point
Owner hit the exact gap this closes: pressed ⌘1-4 (pages), wanted to
switch TABS, had no idea how, and had to LEAVE the page and dig through
Settings to find out. The principle: **unblock yourself in place** —
the palette must be the "how do I do X / what's possible here" surface,
not just a runner. Concrete requirements this adds:
- **Every command row shows its shortcut inline** (⌘K → type "tab" →
  see `Next tab · ⌃Tab` without leaving the page). The palette IS the
  in-place shortcut reference, doubling as the ⌘? "keyboard help" the
  owner also asked for — bind ⌘? (and/or ⌘/) to open it too, or open a
  shortcuts-focused view.
- Palette contents = commands (with shortcuts) + workflows (run) + tab
  navigation (switch/close a specific open tab by name — directly
  addresses the tab-UI friction below) + Configure entities.
- Ties to SPEC §1's real-time/self-service ethos: never make the user
  leave to learn how to do the thing they're mid-doing.

## Acceptance
Owner summons, types three letters, runs a workflow — and the row
they picked showed them the hotkey they'll use instead next time;
their most-used workflows are already at the top without configuring
anything.

**Note (2026-08-11)**: "Owner summons" now means the Quick Panel
(ADR-0033), not this ⌘K palette directly — the "types three letters,
runs a workflow" run path is real and built there today; the
inline-hotkey-hint and frecency/pins halves of this acceptance bar are
still the unbuilt remainder this goal file tracks, for either surface.

**Note (2026-08-12)**: frecency landed session 1; the command-shortcut
half of the inline-hotkey-hint bar landed session 2 (both below). What
remains against this Acceptance sentence's literal wording is narrower
now: a workflow row's own Hotkey-TRIGGER combo (as opposed to an
app-level command's shortcut, which is done) — see "Still open" below.

## Remainder delivered 2026-08-12 — three of four items, into the Quick Panel

Investigated and confirmed DoR-met (the usage substrate, the RPCs, and
the live-sync infra all already existed — nothing here needed new
backend surface):

- **Frecency (frequency-only, not frequency+recency)**: the Quick
  Panel's workflow list now sorts by `ExecutionService.HomeMetrics`'
  `mostUsed` (goal 0014's own value-mirror substrate, `mostUsedFor` —
  every run counted regardless of Kind/Status, over the entire local
  run history, not a rolling window) — `app/workflowFrecency.ts`
  (`sortWorkflowsByFrecency`), unit-tested
  (`workflowFrecency.test.ts`) and proven live end to end (a workflow
  run twice from the panel sorts above one never run,
  `e2e/quick-panel.spec.ts`). **Pins are NOT built** — grepped the
  whole codebase first, confirmed no pin/favorite concept exists
  anywhere (not even a stub) — recorded as its own, smaller tech-debt
  line in `docs/goals/BACKLOG.md` rather than inventing schema for it
  ad hoc under this goal.
- **Pending-review count**: the Quick Panel is its own Wails window
  (ADR-0033) — App.tsx's existing `reviewPendingCount` effect only
  ever ran in the main window's React tree. `QuickPanel.tsx` now owns
  a second, independent read of the same two sources
  (`ExecutionService.ListRuns` pending runs + `SettingsService.
  PendingMCPWrites`) and the same two live-update events
  (`guardrail-pending-changed`, `mcp-write-approval`) — a "Review" row
  always present (unblock-yourself-in-place), badged once non-zero.
  Deliberately does NOT re-run App.tsx's `SetPendingBadge`/
  `NotifyPendingApproval` side effects (the main window already owns
  those; a second window firing them too would double-notify).
  Proven e2e with a REAL parked MCP write via the existing MCP test
  client (`mcpTestClient.ts`), asserting the badge updates live while
  the panel stays open and mounted — not just on next open.
- **Configure entities**: connectors (`ConfigureService.HTTPRequests`,
  "Integration" tab), Lists (`.Lists`), MCP Servers (`.MCPServers`) —
  all already-bound RPCs, already read via the shared stores
  (`shared/store.ts`'s `requests`, `shared/configureEntityStore.ts`'s
  `lists`/`mcpServers`) — now render as searchable/jumpable rows
  alongside workflows, each landing the MAIN window on its own
  Configure tab (`SettingsService.OpenMainWindow('configure:<tab>')`
  → a new `app/useMillNavigate.ts` hook, extracted out of App.tsx to
  stay under the 500-line convention → `View.tab` → `ConfigureView`'s
  new `initialTab` prop). Lands on the TAB, not the individual
  entity's own row within it — deep-linking to one specific entity's
  edit form would need `ConfigureView`'s tab components to accept a
  selected-row id too, real additional scope beyond what this
  remainder's DoR covered. Proven e2e (search "country" → jump →
  the main window's Configure > Lists tab is visible with the seeded
  "Example: Country codes" row).

## Inline-hotkey-hint remainder delivered 2026-08-12 (session 2) — the COMMAND-shortcut half

Owner's fresh ask (with screenshots): Chrome's own "Search Tabs"
dropdown shows a bound shortcut inline next to the action, near where
the user actually clicks it, not just in a central reference list.
Built as one shared, O(1) single-source-of-truth piece rather than a
per-surface copy:

- `app/HotkeyHint.tsx`: `resolveHotkeyLabel(commandId, overrides)` (a
  plain function, unit-tested in `HotkeyHint.test.ts` without needing
  `@testing-library/react`, which this repo doesn't have installed),
  `useCommandBinding` (the same resolution as a store-subscribed hook),
  and `<HotkeyHint commandId="..." />` (renders the chip, or nothing
  for an unbound command — never a placeholder). All three read the
  exact same `shared/commands.ts` default + `store.ts`
  `keybindingOverrides` merge `KeyboardShortcutsSection.tsx`'s Settings
  list already used via `effectiveBinding` — a rebind in Settings is
  reflected everywhere without a second hardcoded copy to drift.
- **Two real commands + default bindings**, not just a display
  pattern: `tab.closeOthers` (⌘⌥W, Safari's own "Close Other Tabs"
  combo) and `tab.closeAll` (⌘⇧W, Safari's "Close Window" combo,
  repurposed the same way `tab.close` already repurposed plain ⌘W) —
  both wired into `app/WorkTabShell.tsx`'s tab-overflow menu, both
  rebindable in Settings like every other command. Proven end-to-end
  in `e2e/hotkey-hint.spec.ts`: the menu shows both hints, the real
  shortcuts actually close tabs, and rebinding `tab.closeOthers` in
  Settings updates the SAME hint the overflow menu renders (the
  single-source-of-truth requirement, not a screenshot-alike).
- Applied to `app/QuickPanel.tsx`'s "Open Settings" row, replacing a
  literal hardcoded `"⌘,"` string that would have silently gone stale
  the moment `settings.open` was ever rebound — a real, if minor, bug
  this closes. `app/CommandPalette.tsx`'s own pre-existing command-row
  shortcut rendering (built in the 2026-08-11 core, before this
  session) was refactored onto the same shared component too, removing
  its independent, duplicated `ShortcutHint` + `effectiveBinding`
  computation (was one of two near-identical copies this session found
  and consolidated, `QuickPanel.tsx`'s "Open Settings" hardcode being
  the other).
- Deliberately NOT built: a hint on QuickPanel's per-workflow "Run"
  rows — no real `commands.ts` entry exists for "run this specific
  workflow" (each is dispatched by ID, not a named command), and
  inventing one to have something to hang a hint on would be exactly
  the "don't invent per-workflow bindings that don't exist" trap this
  session's own scope named up front.

## Still open — the WORKFLOW-trigger half, distinct from the above

- **Inline hotkey hint per workflow's own Hotkey TRIGGER** (still the
  ⌘K palette's documented simplification from the 2026-08-11 core
  build — `app/CommandPalette.tsx`'s workflow-row comment: shows the
  trigger NodeType label, e.g. "Hotkey trigger," not the live
  armed/hotkey-combo detail `TriggerRowLabel.tsx` owns). This is a
  DIFFERENT registry than the command-shortcut work above — a
  workflow's own trigger hotkey (`TriggerService`, per-workflow,
  claimed via `TriggerService.ClaimedCombos`) rather than an app-level
  command (`shared/commands.ts`). Still not built, still the literal
  "showed them the hotkey they'll use instead next time" reading of
  this goal's Acceptance sentence when "the row" is a workflow, not a
  command — building it would need the workflow's own live trigger
  combo fetched and formatted the way `TriggerRowLabel.tsx` already
  does for the canvas, ported into the palette/panel's row-rendering.
- **⌘?/⌘/ multi-binding alias** — needs a command to carry more than
  one `KeyCombo` (today's registry is 1:1, `shared/commands.ts`'s
  `defaultBinding: KeyCombo | null`); recorded as a BACKLOG.md
  tech-debt line, not silently dropped.
- **Pins/favorites** — no schema exists yet for either surface;
  recorded as its own, smaller BACKLOG.md tech-debt line (separate
  from the alias — different kind of missing infra, a data model vs a
  registry shape).

This goal file stays OPEN (not archived) until the three items above
are picked up — none of them block the palette/panel being genuinely
useful today (the command-shortcut half above is real and shipped),
but the Acceptance sentence's workflow-row reading isn't fully true
until the first one lands.
