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

Mill re-signs itself after each update with a signing identity unique
to your Mac, so permissions like Accessibility and Input Monitoring
stay granted across updates instead of asking again every time. **This
needs a one-time setup step before it takes effect** — open Keychain
Access, find the "Mill-Signing" keychain in the sidebar, select the
"Mill Local Signing" certificate inside it, choose File → Get Info,
expand Trust, and set "Code Signing" to Always Trust. Until you do
this, updates still install normally, but Mill can't re-sign itself
yet — permissions behave the same as before (you may need to re-grant
them after an update, same as always) and Mill tells you so after an
update if that happened.

The first update after this landed still needs one fresh grant per
permission either way — macOS treats it as a new app once. If a
permission you already granted stops working (the summon hotkey goes
unresponsive, for example), open **System Settings → Privacy &
Security**, remove Mill from the affected permission, then add it
back. On a Mac where that doesn't help, clear the stale entry from
Terminal and re-grant from scratch:

```
tccutil reset Accessibility com.alicoding.mill
```
