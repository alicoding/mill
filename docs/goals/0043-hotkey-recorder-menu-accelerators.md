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

## Acceptance (checkable)

- [ ] With the recorder active, ⌘⇧W / ⌘W / ⌘Q are captured as
      combos, not executed (manual desktop check, registry-listed).
- [ ] Recorder cancel/blur restores the full menu (manual check).
- [ ] Any pure logic extracted for the swap is unit-tested.
- [ ] PR merged green.
