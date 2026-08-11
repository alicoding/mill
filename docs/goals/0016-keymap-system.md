# 0016 — Keymap system: VS Code-style customizable shortcuts

## Goal
Owner ask (2026-08-10): an app-wide keyboard convention, user-
customizable like VS Code, with keyboard-first navigation — and ⌘W
closing the active WORK TAB, not the window (the expected tabbed-app
semantics; the current native Close-Window binding is the same
mechanism behind the recorder incident).

## Design direction
1. **Command registry**: named commands with default bindings —
   `tab.close` (⌘W: active work tab; window only when none remain),
   `tab.next/prev` (⌃Tab/⌃⇧Tab), fold in existing view nav (⌘1-4) and
   ⌘, ; add `workflow.save` (⌘S — currently button-only),
   `workflow.run`, `workflow.new`; 0015's palette (⌘K) registers here
   when built.
2. **Settings → Keyboard Shortcuts**: searchable command list, each
   row rebindable via the EXISTING hotkey-capture recorder (goal
   0001's fix already gives it menu-accelerator suspension + the
   OS-reserved blocklist). Persisted in the settings store;
   conflict-checked against other commands AND workflow trigger
   hotkeys (TriggerService.ClaimedCombos — one conflict space).
3. **Menu-owned combos** (⌘W family): the recorder fix's menu
   machinery (SettingsService's lazily-installed, walkable menu)
   reroutes the item's action through the command registry — the
   enabler that just merged. In-window commands stay browser keydown
   per §3.7's deliberate choice.

## Default keybinding set — DECIDED by industry research (2026-08-10)
Primary-sourced (Apple HIG, VS Code, Safari/Chrome, Linear/Slack/
Notion), collision-checked against Mill's shipped ⌘1–4/⌘, and the
RESERVED_COMBOS blocklist:

| Command | Default | Source / note |
|---|---|---|
| `tab.close` | ⌘W | universal; reroute from menu-close (the recorder-fix machinery) |
| `tab.next`/`tab.prev` | ⌃Tab / ⌃⇧Tab | the one combo Safari AND VS Code share (⌘⇧]/[ = rebindable alias) |
| `workflow.new` | ⌘N | editor "new typed document" convention — NOT ⌘T (browser blank-tab) |
| `workflow.save` | ⌘S | maps to save-DRAFT only; Publish stays deliberate, no shortcut |
| `workflow.run` | ⌘↩ (Cmd+Enter) | **Owner decided 2026-08-10: ⌘R is NOT a Mill concept** (browser/dev reload — owner uses ⌘⇧R to debug), superseding the original ⌘R pick. Implementation confirmed the real collision the research under-called: macOS's DefaultApplicationMenu installs View > Reload on ⌘R unconditionally (Wails' `menuitem_roles.go`) — releasing it would have taken the owner's native-reload escape hatch. ⌘↩ is the editor/chat "run/submit" convention (Slack/Linear/IDE run-config) with zero RESERVED_COMBOS/menu collision; ⌘R/⌘⇧R stay native reload. Ties to SPEC §1's real-time value: reload is a dev hatch, not a product affordance. |
| `palette.open` (0015) | ⌘K | Linear/Slack standalone — NOT VS Code's ⌘⇧P; ⌘K there is a chord prefix. Alias ⌘P later (Notion pattern) if wanted |
| view nav / settings | ⌘1–4 / ⌘, | already shipped, confirmed convention-correct |

**Last-tab-close**: Mill is the VS Code shape (window stays, not
browser close-window) — and near-moot since §3.8's pinned list tab is
always open, so "no tabs" is an edge case, not the everyday close.
**Explicit non-collision**: do NOT add ⌘1–9 jump-to-Nth-work-tab
(Safari/Chrome pattern) — ⌘1–4 already means sidebar views.

## Acceptance
⌘W closes a work tab (window only when none open); ⌘S saves from the
canvas; the owner rebinds a command in Settings using the same
recorder UX as workflow hotkeys, and a conflict with a workflow
trigger combo is rejected with the owning workflow named.
