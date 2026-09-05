# Settings

Preferences about Mill itself, not any one workflow — most apply the
moment you change them and persist across restarts; the few that need a
restart say so.

Settings is a list of groups on the left and one group's page on the
right: General, Appearance, Security, Shortcuts, Extensions,
Connections, Notifications, Backups, Updates. Only the group you pick
is on screen, and Mill reopens Settings on the group you read last.
Each setting is one row: its name and a short line about it on the
left, its control on the right, with **Learn more** wherever the full
story lives in these pages. Every group is also one command away —
search "Settings" in the command palette (⌘K) to jump straight to a
group.

## General

- **Launch at login** — start Mill when you sign in.
- **Save changes** — Automatically (the default): edits save as you
  make them, and quitting or restarting saves anything still open.
  When I choose: edits wait until you press ⌘S; a note or sheet with
  unsaved edits shows a dot, and Mill asks Save all / Discard / Cancel
  before it quits, restarts, or closes its window.
- **Canvas navigation** — how scrolling moves the Atlas board and the
  workflow canvas. Trackpad: scrolling pans, pinch or ⌘-scroll zooms.
  Mouse: scrolling zooms, drag pans. Stored per device, so each
  computer keeps its own choice.

## Appearance

- **Color theme** — light, dark, or follow the system. Every open Mill
  window follows the change at once, including the Quick Panel, the
  menu-bar panel, and the run monitor.
- **Light appearance** and **Dark appearance** — the color scheme used
  in each: Default, High contrast, Colorblind, Colorblind high
  contrast, Tritanopia, and Tritanopia high contrast, plus Dimmed for
  the dark appearance. When the theme follows the system and the system
  asks for more contrast, Mill switches to the high-contrast version of
  the scheme you picked.
- **Accent** — Mill uses your system accent color when the platform
  reports one, and its own teal when it doesn't. There is no accent
  picker.
- **Density** — Comfortable or Compact. Compact tightens rows and
  spacing across the app: list and palette rows, the Quick Panel,
  tables, canvas card faces, and Settings itself. On a phone-sized
  window, touch targets keep their full size either way.

## Security

- **Lock the vault after** — how long the vault may sit idle before it
  locks itself: one minute to eight hours, a custom number of minutes,
  or never. Counts time since you last used this Mac, so working in
  another app keeps the vault open.
- **Lock when this Mac sleeps or the screen locks**, **when switching
  users**, and **when Mill's window is minimized** — three checkboxes
  that close the vault regardless of idle time. The first two start on.
- **Ask for Touch ID, an Apple Watch, or your password before
  unlocking** — turn this on and Mill asks before the vault opens,
  naming only what this Mac can actually offer. Changeable only while
  the vault is unlocked.

The Secrets page's own status line states both halves in one
sentence — what it takes to unlock, and how long it stays open — and
links back here to change either one.

## Shortcuts

- **Global hotkey** — a shortcut that opens the Quick Panel from any
  app. Recording a combo captures it even if a menu shortcut already
  uses it; Escape cancels recording. The panel's own actions — Open
  Mill, Open Settings, Review, Apply from clipboard, and any update
  action currently available — match the command palette exactly,
  since both read from the same list.
- **Keyboard shortcuts** — every command Mill dispatches in its own
  window, searchable, with editable bindings. Click a combo to record
  a new one; Reset returns the default.

## Extensions

One list of everything that can put an object on the canvas: **Built
in** (grouped into Knowledge, Files and Drawing) and **Installed** —
the plugins in your plugins folder. Each row is the extension's icon,
its name, one line about it, and the switch that turns it on. Turning
one off hides its tray button (or, for file-backed types like Diagram
and Sheet, stops new ones landing on drop); objects already on the
board keep working. **Turn all off** flips every built-in at once.

Click a row to open its page beside the list. That page carries
everything else: the full description, what it adds (its commands,
canvas objects, workflow steps, views and captures), what it can reach
outside Mill, where it came from, and any settings it declares.

The Note offers **Rich code blocks**: turn it on and code fences in
notes get syntax coloring and the full code editor, starting the next
time a note opens for editing. The Sheet offers **Preview rows** and
**Preview columns**: how much of a spreadsheet shows on the board
before the "showing the first…" note. The Table offers **New grid
(experimental)**: tables render with the adopted spreadsheet grid
(keyboard navigation, range selection, copy and paste); column
editing stays in the current grid for now. Text and number settings
save when you press Enter or leave the field.

An installed plugin's page adds **Reload** — pick up an edit without
restarting Mill — and a **…** menu holding **Remove…**. Removing asks
first, then moves the plugin's folder to the Trash; objects it created
stay on the board as unknown kinds until it is installed again. Nothing
is deleted, so putting the folder back restores the plugin — it asks
to be allowed again, the way any newly installed plugin does. Plugins
that ship inside Mill have no Remove.

Above the list: **Open plugins folder** and **Reload all**. Copy a
plugin folder there, then reload it.

## Connections

Everything that reaches Mill from outside: MCP access, Remote access,
and the Contract export, in that order.

### MCP access

Lets connected agents read Mill's catalog and, if you turn on
imports, create workflows and Configure entries. Reading never
includes secrets. Set the address here to accept connections from
other devices, not just this Mac — changes take effect after you
restart Mill. See "Automate with agents" for the full picture.

### Remote access

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

### Contract

Export the full step catalog, every data schema, and this app's
version as one file, or the skill doc that explains how to work with
Mill — for an agent that can't reach Mill over MCP.

## Notifications

- **Away after (seconds)** — how long this Mac sits idle before a
  parked decision follows you with a floating approval prompt. Losing
  focus entirely always counts as away.
- To get alerts that stay on screen rather than banners that
  auto-dismiss, allow them in System Settings > Notifications > Mill.

## Backups

Mill snapshots your workflow history, settings, and your secrets
vault automatically — on clean shutdown, on version change, and daily
via the built-in "Backup Mill data" workflow, keeping the most recent
ten. "Back up now" adds one on demand. "Export everything" bundles
your data into one file for moving machines, excluding the vault;
"Import everything" merges it back. The export covers Mill's own
data — files mirrored from folders on disk are referenced by path,
not copied in, so back those folders up separately.

## Updates

One button drives the whole update flow, and its label always says what
it does next: "Check for updates" while idle, "Download vX and
install" once a newer version is found, and "Restart to update" once
it's ready to go — Mill never restarts on its own, so nothing happens
until you click it. The status line above it shows your current
version, release channel, and when Mill last checked. Running "Check
for updates" from anywhere — the command palette, the Quick Panel, or
here — always answers in the bottom-right corner: a brief "Checking
for updates…", then "You're up to date." when there's nothing new, or
a notice you can click through to this page if the check fails. The same
"Update available" notice in the bottom-right corner acts the same
way: click it to download directly, or click "Restart to update" once
it's ready — it never just opens Settings.

Click "What's new", next to the status line or on the notice's own
secondary link, to read the release notes for the version Mill most
recently found — grouped by version, with headings and lists rendered
normally instead of raw markdown. Before any check has found a new
version, it explains that and offers "Check for updates" right there.

Pick a release channel from the dropdown. Turning on "Check for and
download updates automatically" downloads a newer version in the
background as soon as it's found; the interval below it controls how
often Mill checks on its own — Hourly (the default), Daily, Weekly, or
Only when I check, which turns off the background check entirely and
leaves it to you. If a newer version shows up while an older one is
already downloaded and ready, Mill re-targets the newer one
automatically — restarting always applies the newest version Mill
knows about, never an older one left over from an earlier check.

Every update action is also available from the command palette (⌘K)
and the Quick Panel: search "update" to check, download and install,
or restart, whichever is currently possible.

Mill re-signs itself after each update with a signing identity unique
to your Mac, so permissions like Accessibility and Input Monitoring
stay granted across updates instead of asking again every time. **This
needs a one-time setup step before it takes effect** — open "How
updates stay trusted" below the update button and click "Trust Mill's
signing," then confirm with your Mac password or Touch ID when
prompted. Until you do this, updates still install normally, but Mill
can't re-sign itself yet — permissions behave the same as before (you
may need to re-grant them after an update, same as always) and Mill
tells you so after an update if that happened.

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
