# Goal 0043 — Hotkey recorder vs native menu accelerators

Owner-picked 2026-08-13. The underlying bug is owner-hit and recorded
in goal 0001's "Live-review additions (2026-08-10)": while the
Settings hotkey recorder is capturing, pressing a combo that is also
a native menu accelerator (⌘⇧W closed the window — and Mill exits on
last-window-close, so the app quit; ⌘Q would too) fires the menu
action instead of being recorded, because macOS checks menu
key-equivalents before the webview ever sees keydown. It was deferred
"after the 0008 build lands" — 0008 landed 2026-08-10, so this is
overdue.

## Goal

Recording a hotkey can never trigger a native menu action or quit the
app; permanently-OS-reserved combos are surfaced to the user instead
of silently failing.

## Plan (from the original live-review note, verify before building)

Suspend the app menu's accelerators while the recorder is active:
swap in an accelerator-free menu on record-start, restore the real
menu on capture/cancel/blur — plus a warning in the recorder UI for
combos macOS reserves at the OS level (which no menu swap can
reclaim). Needs the real desktop app for verification (menu behavior
is OS-bound — manual-only registry entry per testing.md, plus unit
coverage for whatever pure menu-construction logic the fix factors
out).

## Pickup finding (2026-08-13): already built, never closed

The entire mechanism exists on main, shipped by an earlier session
without closing this goal's originating live-review note:
`SuspendMenuAccelerators`/`RestoreMenuAccelerators`
(`settingsservice_menu.go`) strip every key-equivalent off the native
menu while ANY recorder is armed — reference-counted across the three
independent recording surfaces (canvas Inspector via
`hotkeyCapture.ts`, per-row trigger capture, SettingsView's summon
recorder), restored in the same effect's cleanup on every exit path
(capture, Escape, reserved-combo rejection, unmount, and window
blur — blur explicitly added after being identified as the leak),
server-mode-safe via the established build-tag split, unit-tested
(`settingsservice_menu_test.go`). The reserved-combo warning also
exists (`reservedByMacOS` + user-facing error copy). What this pickup
added: the manual-only registry entry in `.claude/rules/testing.md`
(it was silently absent) and this record.

## Acceptance (checkable)

- [x] With the recorder active, ⌘⇧W / ⌘W / ⌘Q are captured as
      combos, not executed — manual desktop check now
      registry-listed in testing.md; owner verification this session
      is the closing evidence.
- [x] Recorder cancel/blur restores the full menu — same manual
      check; blur path verified present in code
      (`hotkeyCapture.ts`'s effect cleanup + blur listener).
- [x] Pure logic unit-tested — `settingsservice_menu_test.go`
      (reference counting, idempotent restore).
- [x] Shipped on main via earlier PRs (pre-dating this goal file);
      this closure PR carries only the registry entry + record.
