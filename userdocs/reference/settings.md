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
shows on the other device within 5 minutes. The pairing page tells you
how long a paired device stays signed in and that you can revoke it
anytime. Paired devices appear below with when they were paired and
last seen, a pencil to rename them, and a Revoke button that
disconnects them immediately.

If you already have a background Mill instance reachable from another
device — for example, one kept running over Tailscale — it now asks
for pairing the first time you reach it after upgrading. A background
instance has no window to show "Pair a device" in, so the pairing page
itself tells you to find the code in the instance's log instead, and
writes one there on every startup until a first device pairs. Find
that code wherever you already check the instance's output, then pair
from any device the same way — enter it within 5 minutes. Once a
device is paired, the instance stops writing codes to its log.

Code expired before you could read it? The pairing page has a "Get a
new code" button — it writes a fresh code to the instance's log (or to
Settings, on this Mac) without needing a restart, and works even after
another device is already paired.

Locked out of a background instance with no paired device left to pair
from? Stop it, delete its saved device list, and start it again — it
writes a fresh code to its log, same as an instance that's never been
paired.

On a phone or another computer's browser tab, turn on "Notify me on
this device" in Settings > Remote access to get a notification when a
decision needs your action. Your browser asks for permission the first
time. Notifications only appear while that tab isn't in view, and
clicking one brings you straight to the item waiting for you. If
notifications are blocked, turn them back on in your browser's site
settings — Mill can't ask again automatically.

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

Turning on "Check for and download updates automatically" makes Mill
download a newer version in the background and show a Restart button
once it's ready — Mill never restarts on its own, so nothing happens
until you click it. On the beta channel, a newly-seen version has to
stay the newest release for a short while before Mill downloads it, so
a run of back-to-back beta releases doesn't trigger a download for
every one of them.

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
