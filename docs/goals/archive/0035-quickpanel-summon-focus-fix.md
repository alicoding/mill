# 0035 — Quick Panel summon: stop an already-open main window from surfacing too

## Goal
Owner-observed live tonight, screenshots attached: pressing the global
summon hotkey (⌘⇧J) while working in a different app (a terminal)
correctly opens the Quick Panel — but Mill's main window, already open
in the background from earlier work and not the frontmost window,
surfaces alongside/behind it. This breaks the Quick Panel's own stated
promise (its Settings copy): "search and run a workflow, or jump into
Mill itself, without leaving what you were doing." A background window
popping up mid-summon is exactly "leaving what you were doing."

## Root cause
`settingsservice_panel.go`'s own comment already documents that Wails3
beta.4 has no first-party non-activating-panel mechanism (`NSWindow`,
not `NSPanel`; `canBecomeKeyWindow` hardcoded `YES`) — showing ANY
window, including the Quick Panel, activates the whole app at the OS
level, and macOS raises ALL of that app's windows on activation, not
just the one shown. `yieldFocusIfMainHidden` already mitigates this on
**dismiss** (hide the whole app if main isn't visible either) but had
no summon-side counterpart — an already-open-but-backgrounded main
window had nothing stopping it from riding the app-activation wave.

## Plan
1. [x] Investigate what Wails3 beta.4 exposes for "was this window
   genuinely in use right before this" rather than guessing an API
   shape. Read the pinned source directly
   (`~/go/pkg/mod/github.com/wailsapp/wails/v3@v3.0.0-beta.4`).
   **Found: `WebviewWindow.IsFocused()` (`webview_window.go:750`)
   calls through to the native `impl.isFocused`, which on macOS
   (`webview_window_darwin.go:1056-1058`) is literally
   `[nsWindow isKeyWindow]`.** This is a real, per-window, real-time
   OS signal, not an app-wide "is Mill active" flag: a window can only
   be the key window if the app is active AND that specific window has
   keyboard focus. If a different app (the terminal) was frontmost
   when the hotkey fired, `main.IsFocused()` is `false` regardless of
   whether the main window is visible — exactly the "open but
   backgrounded" case this bug is about. If the user was genuinely
   looking at Mill's main window and pressed the hotkey deliberately,
   `main.IsFocused()` is `true` at that instant — the case that must
   NOT be touched.
2. [x] Make `TogglePanel` symmetric with the dismiss-side mitigation:
   before `p.Show()`, if the main window is visible but not focused
   (`main.IsVisible() && !main.IsFocused()`), call `main.Hide()` first
   so app-activation has nothing backgrounded to raise. If main is
   visible AND focused (the user was actively in it), or not visible
   at all (nothing to hide), this is a no-op.
   Extracted as a pure, unit-testable function,
   `summonShouldHideMain(mainVisible, mainFocused bool) bool`, called
   from `TogglePanel` — the only part of this fix that doesn't need a
   real OS window to verify.
3. [x] Proof: the condition function gets a Go unit test
   (`settingsservice_panel_test.go`) covering all four combinations.
   The full live behavior (an actually backgrounded main window
   staying backgrounded through a real summon) needs a real second app
   to be frontmost and a real NSWindow activation — not reproducible
   headlessly (server mode has no native run loop at all, confirmed
   already by ADR-0033's own manual-only entry for this exact window).
   Registered in `.claude/skills/run-mill/SKILL.md`'s existing
   Quick-Panel manual-only entry rather than opening a new one.
4. [x] SPEC/ADR-0033 note: the focus-yield mitigation's "Consequences"
   section gets a short update — the round trip is now symmetric
   (summon-side guard + dismiss-side yield), not just dismiss-side.

## Acceptance
With Mill's main window open but backgrounded (another app frontmost),
pressing the summon hotkey shows only the Quick Panel — the main
window stays hidden and does not visibly flash/raise. With Mill's main
window open AND focused, pressing the summon hotkey does not hide it
out from under the user.

**Met 2026-08-12, logic-complete + unit-tested; live desktop
verification deliberately deferred to the owner, not fabricated.**
`TogglePanel` now calls `summonShouldHideMain` before showing the
panel and hides `main` when it returns true;
`go test ./internal/services/settingssvc/...` passes, including the
new `TestSummonShouldHideMain` (all four visible×focused
combinations). Live verification requires a real second frontmost app
plus real NSWindow activation, which this session deliberately did not
attempt: the owner already had a real `wails3 dev`/`mill-server`
session running live against the main checkout when this fix started,
and the owner's machine had a genuine memory incident earlier
tonight — starting a second `task dev` process in this worktree to
self-verify would be exactly the kind of parallel heavy process this
session was told to avoid, and it would only exercise the main
checkout's code anyway, not this branch. Registered as the newest
entry in `.claude/skills/run-mill/SKILL.md`'s existing Quick-Panel
manual-only block, with explicit repro steps, per
`.claude/rules/testing.md`'s "a manual-only registry entry with a
clear repro counts as proof" precedent (goal 0029) — the owner's own
next `task dev` session is the real verification, not a claim made
here.
