# ADR-0033 — Quick Panel: a dedicated second window for the summon hotkey

Status: accepted (owner-directed build 2026-08-11).

## Context

The global summon hotkey (§3.7, ADR-0020) has shown/restored/focused
Mill's own main window since it was built. The owner's actual muscle
memory for a summon hotkey is Raycast (⌥Space) / Alfred / 1Password's
Quick Access — a small, focused floating panel that appears wherever
the pointer/attention already is, lets you search-and-act in a few
keystrokes, and disappears — not "bring an entire multi-page app
window to the front." Mill's own ⌘K in-window command palette (goal
0015, `app/CommandPalette.tsx`) already proves the search-and-run UX
works, but it only exists *inside* the main window's own React tree —
useless as a summon target when the main window itself isn't the thing
you want on screen. §3.7 v1's design note ("The §3.7 OS summon hotkey
opens the window INTO the palette") is the direction this ADR
supersedes: the palette-in-main-window shape doesn't give the
Raycast-style "appears anywhere, dismisses cleanly" behavior, only
"brings the whole app forward, then also opens a dialog in it."

This ADR keeps goal 0015's palette as-is (⌘K, in-window, spans
commands/workflows/tabs — that scope is still exactly right for
*already being in Mill*) and adds a second, purpose-built surface for
*not yet being in Mill*.

## Research — what Wails3 v3.0.0-beta.4 actually supports

Checked directly against the pinned source
(`~/go/pkg/mod/github.com/wailsapp/wails/v3@v3.0.0-beta.4`), not
assumed from docs, cross-checked against the tag:

- **Multi-window works cleanly.** `app.Window.NewWithOptions` creates
  an arbitrary second `*application.WebviewWindow`; every registered
  `application.Service` (and therefore every Wails-bound RPC Mill
  already has) is available identically in every window — confirmed by
  the framework's own `examples/spotlight` (a real, working
  Spotlight-style second window shipped in the SDK itself, built on
  exactly this mechanism). Events (`app.Event.Emit`) broadcast to every
  open window, not just the one that fired them.
- **`WebviewWindowOptions` has everything this needs, built-in, no
  custom native code:** `Hidden` (create invisible, show on demand),
  `Frameless` + `DisableResize` (a chrome-less fixed-size utility
  window), `InitialPosition: WindowCentered`, `HideOnFocusLost` (auto-
  hides when it loses key-window status — confirmed via source: this
  registers a `WindowLostFocus` listener that calls `Hide()`),
  `HideOnEscape` (confirmed via source: registers a native `"escape"`
  key binding that calls `Hide()`), and `Mac.WindowLevel:
  MacWindowLevelFloating` + `Mac.CollectionBehavior:
  MacWindowCollectionBehaviorCanJoinAllSpaces |
  MacWindowCollectionBehaviorFullScreenAuxiliary` (floats above other
  windows, follows the user across Spaces/fullscreen apps — the exact
  bitmask the SDK's own spotlight example uses for this).
- **Production asset serving has no SPA fallback.** Confirmed directly:
  a second window's `URL` pointing at a bare path (e.g. `/quickpanel`)
  would 404 against the embedded asset server in a real installed
  build, since there's no catch-all route rewrite the way a dev HTTP
  server or a client-side router's `history` mode would provide. A
  **hash route** (`/#/quickpanel`) never leaves the one already-served
  `index.html`, so this works identically in `task dev`, a server-mode
  build, and a real installed `.app` — verified as the correct fix
  before writing any frontend code, not discovered by a broken install
  later.
- **Non-activating panel behavior (an NSPanel that never steals
  keyboard focus, the way Spotlight/Alfred/Raycast's actual native
  panels behave) is NOT available.** Checked directly: Wails3's window
  implementation is backed by `NSWindow`, not `NSPanel`;
  `canBecomeKeyWindow` is hardcoded to return `YES` with no override
  point exposed through `WebviewWindowOptions`. Real, tracked upstream
  requests for this exist and are unmerged at beta.4 — issues #3760 and
  #5359, PRs #5360 and #5024. Per `.claude/rules/architecture.md`
  ("adopt over hand-roll... hand-roll only when no adopted option
  satisfies the hard constraints") and CLAUDE.md's core-domain
  boundary, forking Wails3's native window layer to backport an
  unmerged upstream PR is exactly the inner-platform trap this project
  has already been burned by once (§0) — not attempted. **Tracked as a
  real upstream gap to revisit if/when one of those PRs lands**, not
  silently worked around by a maintenance burden Mill would then own
  forever.

## Decision

**A second, always-alive window** (`Name: "quickpanel"`), created once
at startup alongside the main window, `Hidden: true` until summoned:

- `Frameless`, `DisableResize`, `560×400`, `InitialPosition:
  WindowCentered`.
- `HideOnFocusLost: true` + `HideOnEscape: true` — the two built-in
  dismiss paths; neither needs any custom Go code to implement.
- `Mac.WindowLevel: MacWindowLevelFloating` +
  `Mac.CollectionBehavior: CanJoinAllSpaces | FullScreenAuxiliary` —
  reachable from any Space, any full-screen app, without switching away
  from what the user is doing.
- `URL: "/#/quickpanel"` — the hash-route fix above.
- **Deliberately NOT `Mac.ActivationPolicy: ActivationPolicyAccessory`**
  (unlike the SDK's own spotlight example, which uses it to hide from
  the Dock). `ActivationPolicy` is an app-wide setting, not per-window
  — setting it would also pull Mill's own Dock icon, which conflicts
  with §3.7's already-`LOCKED` tray+dock coexistence decision (goal
  work, "the safer, reversible default"). This ADR doesn't reopen that
  lock.

**The summon hotkey now TOGGLES this window** instead of showing the
main window (`SettingsService.TogglePanel`,
`settingsservice_panel.go`): visible → dismiss it, hidden → show +
focus it. `SettingsService.ShowWindow` (main window show/restore/focus)
stays reachable via the tray icon's click handler and the panel's own
"Open Mill" row (`OpenMainWindow`) — summoning no longer routes through
it directly.

**Frontend**: `main.tsx` branches once, before the first render, on
`location.hash === '#/quickpanel'`, rendering a dedicated
`<QuickPanelApp/>` (own `ThemeProvider`/`BaseStyles`, no `PageLayout`/
sidebar/work-tab-strip) instead of `<App/>`. `QuickPanel.tsx`
(`app/`) reuses `app/CommandPalette.tsx`'s own shapes directly — the
same `FilteredActionList` + `filterPaletteEntries` combo-box pattern,
the same `ExecutionService.RunWorkflow(id, RunKindTest, ...)` quick-run
path — rather than being rebuilt from scratch, but is its own component
(not a shared extraction): CommandPalette is a `Dialog` mounted inside
the *main* window's tree, coupled to that window's own `workTabs`/
`closePalette`/keymap state, none of which exist in a standalone
window with no work-tab strip of its own. Escape is deliberately not
handled again in JS — `HideOnEscape` already covers it natively, and
duplicate-handling was named as a mistake to avoid up front.

## Focus-yield mitigation

Because a non-activating panel isn't available (the research finding
above), showing the Quick Panel — like showing any Wails window —
activates Mill and steals keyboard focus from whatever app the user was
previously in. Accepted as a real, documented compromise rather than
solved: `SettingsService.yieldFocusIfMainHidden` runs on every panel
dismiss (registered once, on `events.Common.WindowLostFocus`, which
fires for all three dismiss paths — `HideOnFocusLost`, `HideOnEscape`,
and the toggle-hide/`DismissPanel` path — confirmed directly: all three
ultimately call the window's own `Hide()`, and ordering a key window
out resigns its key status first). If Mill's *main* window isn't
visible either at that point, it calls `application.Get().Hide()` —
hiding the whole app so macOS hands focus back to whatever the user was
in before summoning, rather than leaving Mill's now-empty frontmost
app state stranded on screen. If the main window *is* visible (the
user navigated into Mill via a panel row), this is a no-op — Mill
legitimately keeps focus.

## Consequences

- The focus-steal-on-show / focus-yield-on-dismiss round trip is a real
  UX compromise, not a solved problem — a genuine non-activating panel
  would be strictly better and should replace this the day Wails3 ships
  one (tracked above).
- The Quick Panel is now the reusable "small floating second window"
  surface in Mill's architecture — the attention-escalation work (a
  floating approval prompt for an away-user guardrail/MCP-write park,
  adjacent to ADR-0032's own away-user research) can reuse this exact
  window shape (frameless, floating, hash-routed, focus-yield-aware)
  instead of re-deriving it.
- `WatchWindowGeometry` (§3.7) is never called for this window
  (deliberately) — its geometry is fixed (`WindowCentered`, fixed
  size), not something that should persist across restarts the way the
  main window's does.
- goal 0015's own palette is unaffected — this ADR only changes what
  the *summon hotkey* opens, not the in-window ⌘K palette's own scope
  or behavior.
