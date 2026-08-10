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

## Acceptance
⌘W closes a work tab (window only when none open); ⌘S saves from the
canvas; the owner rebinds a command in Settings using the same
recorder UX as workflow hotkeys, and a conflict with a workflow
trigger combo is rejected with the owning workflow named.
