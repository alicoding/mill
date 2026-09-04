---
name: manual-checks
description: The manual-only verification registry for OS-bound checks and the rule for adding one; load when adding, running, or auditing an installed-build check.
---

# Manual-only verification registry

OS-bound checks that no headless harness can reach, listed explicitly with
reasons — never silently absent (goal 0010's enforcement). Add an entry here,
not a bare TODO, when a capability's interaction contract depends on real
OS/hardware behavior a harness can't drive (a system dialog, a native drag, a
login-item cycle) — name what's proven at another layer, what only an
installed build can catch, and exactly how to verify it there.

- **The menu-bar surface's OS half** (goal 0189,
  `SystemTray.AttachWindow` + `newTrayPanelWindow`) -- the tray
  ATTACHMENT is OS-bound end to end; the panel's CONTENT is
  e2e-proven at /#/traypanel (tray-panel.spec.ts). Verify on an
  installed build: the icon renders as a template glyph legible on
  BOTH light and dark menu bars; clicking it toggles the panel
  anchored under the icon (frontmost app stays active -- the panel
  is a non-activating NSPanel); clicking away dismisses it; parking
  an approval shows the count beside the icon (SetLabel) and
  clearing it removes the count; the panel's Stop actually cancels
  a live run; right-click still opens the Open Mill/Quit menu.
- **Away-attention dock bounce** (`dockBounceFn`,
  `settingsservice_attention.go`) — the notify adapter's cgo send
  aborts headless; verify desktop-mode by parking an approval while
  unfocused.
- **Menu-accelerator suspension during hotkey recording**
  (`settingsservice_menu.go`) — NSMenu's key-equivalent interception
  only exists in a real window; verify by arming a hotkey recorder,
  pressing ⌘⇧W / ⌘W / ⌘Q (each must be captured as a combo, never
  close/quit), then Escape/blur out and confirming accelerators work
  again.
- **Dev-loop timing** (`BuildIdentityBadge`'s amber `DEV · go-stale`
  state, `isGoSourceStale`) — CI has no live file watcher; verify via
  `.claude/skills/run-mill` by wedging a `wails3 dev` rebuild and
  confirming the badge flips.
- **Release-channel self-update** (goal 0082) — verify after the next
  tagged release, on a release-installed copy: Check for updates →
  Update now → Restart Mill, confirm the new version string.
- **Multi-select box-drag synthesis** (goal 0081) — React Flow's
  pointermove delta sampling coalesces synthesized moves; verify by
  shift-dragging around 2+ cards desktop-mode.
- **apply-notify's real banner** (goal 0114) — an actual notification
  banner is OS-bound (signed-bundle handshake); verify by running the
  seeded Clipboard→Markdown workflow via its hotkey while another app is
  focused and confirming the banner.
- **Close means hide, and the tray always brings the window back**
  (goal 0276, main.go's WindowClosing hook) — the red traffic-light
  close, the hook's Cancel+Hide, and the tray's "Open Mill" restore
  are all native AppKit round trips no harness reaches. Verify on an
  installed build: red-close the main window, confirm Mill stays in
  the tray; tray → "Open Mill" restores the SAME window (state
  intact, no empty "No pending approvals." window appearing); then
  Quit from the tray and confirm the process actually exits, and ⌘Q
  likewise.
- **App archetype: closing the last window must NOT quit Mill**
  (goal 0188) — `Mac.ActivationPolicy` is Regular and
  `ApplicationShouldTerminateAfterLastWindowClosed` is false, which no
  headless check can observe (server mode has no AppKit delegate at
  all). Verify on an installed build: close the main window with ⌘W
  and confirm Mill is still running and reachable from the tray;
  reopen it from the tray; then quit deliberately from the tray's Quit
  item and confirm the process actually exits. The flag composes
  lethally with any path that empties the screen — it terminated the
  app on a background summon, and once before via a window-closing
  accelerator during hotkey recording.
- **Summon from a background app** (goals 0151, 0182, 0188) — the real kill
  chain (hotkey → activation → HideOnFocusLost → the main-window
  restore) needs a real macOS activation dance; verify on an installed
  build with Accessibility granted, main window already open in the
  background (a different app frontmost): hotkey from the other app —
  confirm the panel appears, Mill's main window does NOT flash into
  view alongside it (goal 0035), and the process survives (no
  SIGTRAP); dismiss via Escape, then again via click-away, then again
  via pressing the hotkey a second time — for each path, confirm
  neither Mill nor the previously-open main window vanishes from the
  app switcher/dock, and focus returns to the app you summoned from;
  finally reactivate Mill (dock click or Cmd+Tab) and confirm the main
  window is back, right where it was before the summon.
- **The run monitor window** (goal 0294 S2, `newRunMonitorWindow` +
  `ShowRunMonitor`/`HideRunMonitor`) -- the floating window, its
  close-means-hide hook and the Quick Panel / tray doors that show
  it are native round trips; the route's CONTENT is e2e-proven at
  /#/runmonitor (run-monitor.spec.ts). Verify on an installed
  build: ⌘⇧↩ on a Quick Panel row opens the window floating over
  the current app with the run stepping; the red close hides it;
  ⌘⇧↩ again re-shows it on the new run; a tray Recent row opens it
  on that run; Open in Mill hides it and lands the main window on
  the same run.
- **Bringing a hidden app back on screen** (goal 0186, goal 0188 slice
  2 — `bringMainToFront`/`bringFloatingToFront`,
  `settingssvc/settingsservice_presence.go`) — every path that shows a
  window now un-hides the app first, which only a real app-level hide
  can exercise. Verify on an installed build: repeat the background-
  summon dismiss above until Mill is app-hidden (no window, not in the
  app switcher), then summon again and click the panel's "Open Mill"
  row — confirm the main window actually appears, where it previously
  did nothing silently. Separately, repeat with the tray's "Show Mill"
  item instead of the panel. Separately, park a guardrail/MCP-write
  decision while away and Mill app-hidden — confirm the floating
  approval prompt appears rather than staying invisible behind a
  still-hidden app.
- **Native file-drop delivery** (goal 0081 A3, extended by goal 0179
  S2) — verify by dragging a `.md` file from Finder onto the running
  app and confirming the card lands with the real path; separately,
  drag a `.drawio` and a `.mmd` file and confirm each lands as a
  "diagram" board object (not a card); separately, drag a `.pdf`
  and confirm it lands as a "pdf" object rendering page 1 through
  the vendored viewer (goal 0267 -- the routing decision is
  Vitest-tested, the rendered result e2e-proven via the seeded
  two-page document). The DROP GESTURE itself is a
  structural gap in this harness (Wails3's `WindowFilesDropped` needs
  a real `*WebviewWindow`, which server-mode Playwright's connection
  is not) — the routing decision is Vitest-tested instead
  (`useAtlasDiagramObjectCreate.test.ts`'s `isDiagramPath`). The
  RESULT of a drop (the object's own board-face rendering, and
  Promote to card) IS e2e-proven despite the gesture gap:
  `atlas-diagram-object.spec.ts` lands the object via
  `fixtures/atlasNativeDropEscapeHatch.ts` — a direct call to the
  exact same `CreateBoardObject` RPC every tray click already goes
  through, by its stable Go method name — then drives every assertion
  through the real rendered DOM.
- **Companion panel against a real local model** (goal 0101) — verify
  desktop-mode with Ollama running: judge token-by-token
  responsiveness and whether replies parse into intended proposals
  often enough to be useful.
- **MCP address editable/save/validate path** (goal 0116) — every e2e
  worker sets `MILL_MCP_ADDR` for port isolation, so an env override is
  structurally always active in the shared pool; verify desktop-mode
  (no override set) by entering an address in Settings (confirm the
  restart note), then a malformed one (confirm the validation message).
- **Signing identity survives an update** (goal 0158) — real trust-
  settings state is machine-specific; verify by granting Accessibility
  once, taking two consecutive beta updates, and confirming the summon
  hotkey still registers with no new permission prompt.
- **The real "Trust Mill's signing" authentication dialog, and the
  section hiding once trust is granted** (goal 0220 S3,
  `codesigning.TrustIdentity`/`IsTrusted`) — `security
  add-trusted-cert` against the live per-user Trust Settings domain
  needs a real Window Server session to show its SecurityAgent
  prompt at all (headless/non-TTY calls have been observed to return
  success without recording anything); e2e only reaches the
  server-mode `ErrUnsupportedPlatform` fail-closed path
  (`updates-trust-signing.spec.ts`, which now asserts the section
  absent rather than driving its button), never the real dialog.
  Verify on an installed build: open Settings → Updates → "How
  updates stay trusted" → "Trust Mill's signing", confirm the
  authentication dialog appears and the button shows its trusted
  confirmation once you approve it; run it again and confirm it
  stays idempotent (no error, no duplicate identity); then revisit
  Settings → Updates and confirm the whole "How updates stay
  trusted" section is now gone.
- **SMAppService launch-at-login: the requires-approval state and the
  legacy System-Events migration** (goal 0198,
  `internal/adapters/launchatlogin`) — real SMAppService registration
  state (enabled / requires-approval) and a real pre-existing System
  Events login item both need an actual login cycle on an installed,
  signed bundle; neither exists in the e2e harness (server mode has no
  login-item concept at all). Verify on a build from BEFORE this goal,
  installed and with "Launch Mill at login" turned on (a real System
  Events login item now exists), then upgrade to a build from this
  goal or later: open Settings > General, turn "Launch Mill at login"
  off then on again, and confirm System Settings > Login Items shows
  exactly ONE Mill entry, never two. Separately, on a machine where
  Mill has never been granted a login item before, turn it on and
  confirm the checkbox shows checked with the amber "Confirm in System
  Settings to finish turning this on." notice and its button, then
  approve it in System Settings and confirm the notice clears on the
  next Settings visit.
- **The real system authentication sheet gating an unlock** (goal
  0330, `internal/adapters/localauth`) — `evaluatePolicy` raises
  out-of-process UI (LocalAuthentication's own XPC UI service) that no
  headless build can trigger or dismiss, and the e2e suite runs a
  server build where the framework is not compiled in at all, so it
  only reaches the "not set up on this Mac" disabled-toggle path
  (`secrets.spec.ts`). Verify on an installed build: in Secrets, unlock
  the vault, turn on "Require Touch ID to unlock" and confirm the
  toggle sticks; lock the vault, press Unlock, and confirm the system
  sheet appears BEFORE the vault opens; cancel it once and confirm the
  vault stays locked with "Unlock cancelled." on screen; authenticate
  and confirm it opens. On a Mac with no Touch ID enrolled and no
  password set, confirm the toggle is disabled with "Touch ID or a
  password isn't set up on this Mac."
- **A vault whose key is missing shows the mismatch line, and Start a
  new vault keeps a `.bak`** (goal 0330) — the failure only happens
  against a REAL OS keychain whose contents differ from the vault file
  beside it, which no test may touch (the keychain is machine-global;
  e2e servers run on an in-memory keyring instead). Verify on an
  installed build: quit Mill, move `~/Library/Application
  Support/mill/secrets.kdbx` aside and restore an older copy (or delete
  the `mill-secret-vault-key.<id>` item in Keychain Access), relaunch,
  open Secrets and press Unlock. Confirm the line reads "The key on
  this device doesn't open this vault file." (or "There's no key for
  this vault on this device.") and that "Start a new vault" appears
  beside Unlock; take it, confirm the dialog, and confirm a
  `secrets.kdbx.<timestamp>.bak` sits beside the new vault file with
  the old one's bytes intact.
- **The real sudo askpass / Touch ID escalation prompt** (goal 0240
  S5, `wrapArgvForAdmin`/`materializeAskpass`) — sudo's PAM
  conversation (pam_tid's Touch ID sheet, or the osascript
  hidden-answer password dialog) is out-of-process system UI no
  headless harness can trigger or dismiss; unit tests pin the argv
  wrapping, askpass content/mode, and the secrets-refusal, and the
  guardrail tests pin the always-asks policy — never the real
  prompt. Verify on an installed build: configure the seeded "Run
  from clipboard" shell step with "Run with admin rights", run
  `whoami`, approve the forced ask, confirm the Touch ID sheet
  appears (pam_tid configured) and the output reads `root`; cancel
  the prompt on a second run and confirm the step fails with sudo's
  own error rather than hanging; then confirm an allow-listed
  command STILL parked for approval while the toggle was on.
- **The real browser-tab approval notification** (goal 0132 slice A) —
  requires a real granted browser permission and a real OS compositor;
  verify via a server-mode instance reached from a real browser tab:
  enable notifications in Settings > Remote access, park an approval
  from another tab/device, switch away, confirm a system notification
  titled "Approval needed" appears, and clicking it lands on Review.
- **The real Android ntfy delivery** (goal 0132 slice B) — the ntfy
  wire protocol reaching a real Android device is OS/vendor-app-bound;
  verify by installing the ntfy Android app, subscribing to a paired
  device's URL, parking an approval, confirming the phone receives it
  backgrounded, and tapping lands on Review.
- **Board ⌘V with a REAL pasteboard: screenshot bitmap and Finder
  ⌘C** (goal 0255, `ReadPasteboardFilePaths`/`clipboard.ReadFileURLs`)
  — real pasteboard file flavors and WKWebView's own ⌘V event
  delivery are both OS-bound (the e2e drives a synthesized
  files-carrying paste and the fail-closed empty-paths branch, never
  the real gesture). Verify on an installed build: ⌃⇧⌘4 a region
  (clipboard screenshot) → ⌘V on the board lands the image at the
  pointer; Finder ⌘C a .png → ⌘V lands an image object mirroring
  the REAL file path; Finder ⌘C a .md → ⌘V lands a card, same as
  dropping it.
- **A pdf link annotation actually reaching the system browser**
  (goal 0271, `openExternalUrl` via the runtime's Browser API) —
  launching the real default browser is OS-bound; the e2e pins the
  negative (the click never navigates the app/viewer) and suppresses
  the HTTP-transport call, but the runtime may route over its
  WebSocket transport, so no harness observes the real open. Verify
  on an installed build: click an external link inside a live pdf
  object — the system browser opens the page and Mill stays exactly
  where it was.
- **Canvas navigation with a REAL trackpad** (goal 0257,
  `shared/canvasNavigation.ts`) — Playwright's wheel is synthetic;
  a real two-finger scroll, pinch, and ⌘-scroll are OS/driver-bound
  gestures no harness can produce. Verify on an installed build in
  default Trackpad mode: two-finger scroll pans the Atlas board in
  both axes (no zoom), pinch zooms around the pointer, ⌘-scroll
  zooms; flip Settings > General > Canvas navigation to Mouse and
  confirm a mouse wheel zooms; confirm the workflow editor follows
  the same mode without a reload. Additionally (goal 0271): with a
  live (selected) PDF object and a draw.io object on the board,
  two-finger scroll in every direction with the pointer inside each
  viewer -- the viewer scrolls/zooms and the BOARD holds still (no
  simultaneous pan), including diagonal gestures over a page-width
  PDF whose horizontal axis has nothing to scroll; with the object
  UNSELECTED (shield up -- pdf AND diagram carry it, goal 0302), the
  same gesture pans the board only, and pinch / ⌘-scroll zoom the
  board.
  Synthetic wheel can't reproduce the real gesture stream's
  double-handling, so this stays manual.
- **The quit gate on every native quit path, and explicit mode's
  close guard** (goal 0295 S2b, `SettingsService.ShouldQuit` wired
  as `application.Options.ShouldQuit`, `HideMainWindowGuarded`) --
  ⌘Q, the Dock's Quit, the tray menu's Quit and the red close all
  reach AppKit's applicationShouldTerminate / the WindowClosing
  hook, which no server-mode harness has (the e2e drives the same
  handshake through RestartApp). Verify on an installed build with
  Settings > General > Save changes = When I choose: type into a
  note and click away (the dot shows); ⌘Q shows the Save all /
  Discard / Cancel sheet and Cancel keeps Mill running; hide the
  window, then the tray's Quit brings the window back with the
  sheet; Discard quits. Again with a held note: red-close the window
  shows the sheet titled "...before closing?" and Save all hides
  the window with the note written. Then switch back to
  Automatically and confirm ⌘Q quits with no sheet and the note
  text survives relaunch.
- **The adopted table grid's range and drag interactions** (goal
  0287, ADR-0049, `shared/ListGridGlide.tsx`) -- range ⌘C/⌘V, the
  fill handle, header-edge resize and header drag-reorder are the
  library's own pointer gestures over one canvas; Playwright's
  forced positional click reaches a single cell but not a drag or
  the real clipboard. Verify on an installed build on a table
  object and on Configure's List page: select a 2x2 range, ⌘C, move,
  ⌘V (the rows write through); drag the fill handle down a column;
  drag a header edge (width survives a reload on this device) and
  drag a header onto another (the List's column order changes on
  every projection); then a VoiceOver pass -- the grid's
  accessibility DOM reads the headers and cells (ADR-0049's own
  verification, the library hedges its a11y).
- **A relaunch never restores the floating windows** (goal 0301,
  `SettingsService.HideAuxWindows` on ApplicationStarted and before
  every approved quit / restart) -- macOS Resume re-showing windows
  that were on screen when the process ended is an OS behavior no
  harness reproduces. Verify on an installed build: open the Quick
  Panel, press ⌘⇧↩ on a workflow so the run monitor floats, then
  from the panel type "update" and restart (or ⌘Q from the panel's
  Open Mill) -- on relaunch only the main window appears, the panel
  and the monitor stay hidden until summoned; also relaunch with
  "Close windows when quitting an application" OFF in System
  Settings > Desktop & Dock (the default) and confirm the same.
- **The system accent colour** (goal 0320,
  `internal/adapters/systemaccent`) -- `NSColor.controlAccentColor`
  reaches AppKit through the toolkit's own `EnvironmentManager`, which
  returns "" in server mode, so e2e only exercises the keep-the-teal
  branch; the derivation is Vitest-pinned. Verify on an installed
  build: set System Settings > Appearance > Accent colour to Purple,
  relaunch Mill, confirm the selected sidebar row, a primary button and
  a focused field's ring follow it in light and dark; set it back and
  relaunch. The accent is read per window at mount, so a change made
  while Mill runs appears on the next launch.
- **File-promise drops: the post-screenshot floating thumbnail**
  (goal 0256, `MillFilePromiseDropView` /
  `AttachFilePromiseReceiver`) — a promise drag needs a real AppKit
  drag session end to end; no harness can synthesize one. Verify on
  an installed build: ⌘⇧4 a region, drag the floating THUMBNAIL
  (before it saves) onto the board — the image object lands at the
  drop point, no no-entry cursor; drag an image out of a browser
  page — same; then drag a real file from Finder and confirm it
  still lands exactly as before (the promise view sits BELOW the
  toolkit's own drag view precisely so filename-carrying drags
  never reroute).
- **Drag regions are opt-in** (goal 0333, `frontend/src/app/index.css`'s
  `--wails-draggable: no-drag` default, enforced statically by
  `scripts/check-drag-regions.sh`) — whether a pointer press actually
  moves the NATIVE window is a real AppKit drag session; server-mode
  Playwright has no native window to move. Verify on an installed
  build: dragging on an empty pane area (Home, a canvas, Configure)
  neither moves nor resizes the window; dragging the tab band moves
  it.
