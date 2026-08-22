# Settings

App-level preferences — things about Mill itself, not any one
workflow. Everything here applies immediately and persists across
restarts.

## Appearance

- **Theme** — light, dark, or follow the system.
- **Density** — Comfortable or Compact. Compact tightens rows and
  spacing across the app: list and palette rows, the Quick Panel,
  tables, canvas card faces, and Settings itself. On a phone-sized
  window, touch targets keep their full size either way.

## General

- **Launch at login** — start Mill when you sign in.
- **Summon hotkey** — a global shortcut that opens the Quick Panel
  from any app. Recording a combo captures it even if a menu
  shortcut already uses it; Escape cancels recording.

## Keyboard shortcuts

Every command Mill exposes, searchable, with editable bindings.
Click a row to record a new combo; Reset returns the default.

## MCP access

Lets connected agents read Mill's catalog and, if you turn on
imports, create workflows and Configure entries. Reading never
includes secrets. Set the address here to accept connections from
other devices, not just this Mac — changes take effect after you
restart Mill. See "Automate with agents" for the full picture.

## Backups

Mill snapshots your workflow history and settings automatically —
on clean shutdown, on version change, and daily via the built-in
"Backup Mill data" workflow, keeping the most recent ten. "Back up
now" adds one on demand. "Export everything" bundles your data into
one file for moving machines; "Import everything" merges it back.
The export covers Mill's own data — files mirrored from folders on
disk are referenced by path, not copied in, so back those folders
up separately.

## Updates

Pick a release channel and check for updates; Mill can also notify
you when an update is available (that notification is itself a
workflow you can edit or turn off).
