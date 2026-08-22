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

## Remote access

Mill is reachable from any device on your network. Pairing is what
keeps it yours. This Mac always has access — other devices pair once,
then stay connected until you revoke them.

To reach Mill from your phone or another computer, open Settings on
this Mac and select "Pair a device." Enter the 8-character code it
shows on the other device within 5 minutes. Paired devices appear
below with when they were paired and last seen, and a Revoke button
that disconnects them immediately.

If you already have a background Mill instance reachable from another
device — for example, one kept running over Tailscale — it now asks
for pairing the first time you reach it after upgrading. Pair it the
same way, from that instance's own Settings.

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
