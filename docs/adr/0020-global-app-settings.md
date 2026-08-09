# ADR-0020: Global app settings — SettingsService, launch-at-login, summon hotkey, auto-update, tray, and window/tab state persistence

## Status
accepted

## Context

Distinct from both Configure (§3.5, node-*kind* authoring) and a
Trigger's own per-workflow config (§3.4, e.g. one workflow's hotkey
binding) is a third category: settings that apply to Mill itself,
globally, independent of any specific workflow. Before this ADR, the
only real instance was the theme `SegmentedControl` in
`SettingsView.tsx` plus the sidebar-collapse preference — both
frontend-only, `localStorage`-persisted, cosmetic. Nothing had surveyed
what a *complete* Settings surface should hold.

Two research questions were kept explicitly separate, not conflated:
(1) what global settings a tool shaped like Mill actually needs, and
(2) a `single-user`-today/`hexagonal-architecture`-future-proofing
question about whether `internal/adapters/settings`'s storage boundary
needs a scoping seam. Neither was answered by brainstorming — both
were researched against real precedent.

## Research

### Thread 1 — what belongs in Settings

Checked against real apps' own Preferences/Settings surfaces —
Raycast, Alfred, 1Password Quick Access, Rectangle, Homerow, plus
PowerToys Run/ulauncher as cross-platform checks — specifically the
Spotlight/Alfred/Raycast category of app (a background-resident
utility, summoned on demand, not a document editor with per-file
preferences).

Converged across 2+ independent apps, worth building: **launch at
login** (every app surveyed except 1Password has it); **a global
summon/toggle hotkey distinct from any per-workflow trigger**
(universal — Raycast ⌥Space, Alfred ⌥Space, 1Password Quick Access
⇧⌘Space, PowerToys Alt+Space, ulauncher Ctrl+Space — the strongest
single finding); **menu-bar/tray presence toggle**; **update-check/
version surfaced in Settings**. Less universal, deferred: appearance
settings beyond light/dark (Raycast has them, Alfred/ulauncher don't).
Skipped as app-specific: any AI/Account/Extensions-marketplace tab
(Raycast) — out of scope given §1.1's no-AI-in-Mill lock and Thread
2's no-accounts verdict below; Alfred's location/newsletter settings;
Windows-input-stack-specific PowerToys options. A default working-
directory/scope setting is real but blocked on §6 (execution
environment, still `OPEN`).

**Per-mechanism Wails3 API findings, verified directly against the
SDK/repo, not assumed:**

- **Launch at login**: Wails3 has **no official mechanism** — a
  proposing PR (`wailsapp/wails#3910`) was closed unmerged (checked via
  `gh pr view`); a `pkg.go.dev` page for `v3/plugins/start_at_login` is
  a **false positive** (no such directory exists in the current repo,
  confirmed via `gh api repos/wailsapp/wails/contents/v3/pkg`) — an
  artifact of the abandoned PR's branch. v3's own systray docs example
  even calls an invented `setStartAtLogin()` placeholder, not a real
  API. Wails **v2** shipped a real one (`v2/pkg/mac/login_darwin.go`):
  shells out to `osascript`/System Events, the same shell-out pattern
  `internal/adapters/clipboard` already uses — macOS-only, requires a
  real `.app` bundle. Linux's equivalent is the standard XDG autostart
  `.desktop`-file-in-`~/.config/autostart/` convention (moot until
  §1.3's `PARKED` Linux-desktop-build status changes).
- **Global summon hotkey**: same underlying mechanism as §3.4's
  per-workflow hotkeys (`golang.design/x/hotkey`, already adopted) —
  registration doesn't differ, only the callback body does. Confirmed
  against Wails3's current Window API (`*application.WebviewWindow`'s
  `Show()`/`Focus()`/`Restore()`) and its official Single-Instance
  guide, which shows the exact pattern needed
  (`OnSecondInstanceLaunch: func(...) { mainWindow.Restore();
  mainWindow.Focus() }`) for a structurally identical problem. Zero new
  dependency.
- **Auto-update**: an initial search surfaced a community Sparkle
  proof-of-concept as if it were the answer — overturned by checking
  the current Wails3 repo directly. Wails3 ships its own first-party,
  pure-Go, actively-maintained self-update package, `v3/pkg/updater`
  (reachable as `app.Updater`), confirmed current via real recent
  commits. Downloads the right OS/arch asset, verifies a SHA-256 digest
  (+ optional Ed25519 signature), shows release notes, swaps the binary
  and relaunches "without shipping a separate helper executable" (its
  own doc comment). Ships a GitHub Releases provider by default, plus
  an `appcast` provider speaking Sparkle-style AppCast XML directly
  (including Ed25519 verification) — so even the original Sparkle
  instinct is satisfiable through this same package. Zero new
  dependency either way.
- **Dock/notifications**: Wails3 already ships `v3/pkg/services/dock`
  (menu-bar/dock presence, badge) and `v3/pkg/services/notifications` —
  both would cover the menu-bar-toggle/update-notification convergence
  items with no new library, if/when a concrete design exists for
  either (neither did at the time of this ADR — see Decision §8).
- **Tray icon**: a real, previously-unused Wails3 `SystemTray` API
  (`app.SystemTray.New()`, confirmed by reading
  `pkg/application/systemtray.go`/`system_tray_manager.go` directly),
  zero new dependency.
- **Window geometry persistence**: Wails3 has no first-party opinion.
  `WebviewWindowOptions` only sets *initial* position/size at creation;
  `Position()`/`Size()`/`IsMaximised()`/`IsFullscreen()` are live
  getters with zero persistence; `v3/examples/window` demonstrates
  `OnWindowEvent(events.Common.WindowDidMove/WindowDidResize, ...)` but
  stops at printing to stdout. No reference app in the Wails ecosystem
  does "restore where you left off" well either. Real, citable
  cross-framework precedent instead: VS Code's
  `ExtensionContext.workspaceState`/`globalState` `Memento` split, and
  Electron's `electron-window-state` package's own convention (listen
  to resize/move, debounce, persist bounds + maximized/fullscreen,
  reapply next launch).

### Thread 2 — the settings/storage multi-tenancy seam

`internal/adapters/settings` is one flat JSON file (via Wails3's
`KVStoreService`) with no notion of "whose" setting a key belongs to.
Researched whether a cheap, low-regret seam (a `Scope`/owner concept in
the `Store` port, or key-namespacing) would let a hypothetical future
multi-tenant variant graft on without a full storage rewrite — argued
from four independent angles, not asserted:

1. Hexagonal/ports-and-adapters literature's real answer to tenant
   scoping is baking a tenant ID into every port method from day one —
   a heavy commitment, not a cheap prefix-the-keys trick, so there is
   no citable "free" seam to add.
2. The one substantial research essay on this exact class of problem
   (Ink & Switch's "Local-first software," 2019) treats
   local-first-then-multi-user as fundamentally a CRDT/merge-semantics
   problem — evidence the lightweight version isn't actually available
   either way.
3. Real precedent apps that added team features later did it
   additively at the product/sync layer without a pre-scoped storage
   seam: Raycast for Teams (2022) shipped as new, separate surfaces
   layered on the existing single-user product; Obsidian Sync for Teams
   points independent local vaults at one shared remote vault rather
   than re-scoping local storage. (1Password 8's transition away from
   standalone local vaults is a *counter*-example — a hard breaking
   migration, not a graft.)
4. Martin Fowler's own YAGNI framing draws exactly this line: don't
   build capability for a presumptive feature, but do keep the code
   easy to modify — which Mill already satisfies via
   `internal/adapters/settings`'s existing `Store` interface boundary
   (built for swappability, not multi-tenancy, but already the seam a
   future scoping change would go through).

## Decision

### 1. Launch at login

`internal/adapters/launchatlogin`, split `!server`/`server` build tag
(server mode has no login-item concept regardless of OS, same
reasoning as `internal/adapters/hotkey`). Ports Wails v2's own
`osascript`/System Events approach directly. `appBundlePath` walks a
running executable's path back to its `.app` bundle, returning a named
`ErrNotAppBundle` for a bare dev binary rather than silently no-op'ing.
`GetLaunchAtLogin` queries the real OS state (System Events' login-
items list) rather than a cached preference, so it can't drift from a
user manually removing Mill via System Settings.

### 2. Global summon hotkey

`golang.design/x/hotkey` for registration, `*application.WebviewWindow`'s
`Show()`/`Restore()`/`Focus()` for the callback. Owned by a new
root-package `SettingsService` (`settingsservice.go`), persisted via
the same `internal/adapters/settings` store `TriggerService` already
uses. Bidirectional conflict detection with per-workflow hotkeys:
`TriggerService` gained `ClaimedCombos()` (exposes its own bindings)
and `SetReservedCombo` (an injected-function seam, same shape as
`SetConnectorLookup`/`SetListLookup`), so a workflow hotkey can't
silently collide with the summon hotkey, and vice versa
(`SettingsService.AssignSummonHotkey` checks
`TriggerService.ClaimedCombos()` directly).

### 3. Auto-update

`app.Updater` is `Init`'d in `main.go` with a GitHub Releases provider
pointed at `alicoding/mill`; `SettingsService.CheckForUpdates()`
exposes a manual check via a "Check for updates" button in
`SettingsView.tsx`. Inert until Mill actually starts tagging and
publishing releases (`millVersion` in `main.go` is a placeholder
`"0.1.0"`, zero GitHub releases published as of this writing — real
future work, tied to ADR-0002's release pipeline, §1.3). No
`PublicKey` is configured (no signing key exists yet) — a release
carrying only a content digest still installs today; one carrying a
signature would be rejected once a key is configured.

### 4. Tray icon

A persistent menu-bar icon via `app.SystemTray.New()`, deliberately
**coexisting with the dock icon** rather than replacing it (the safer,
reversible default) — `ApplicationShouldTerminateAfterLastWindowClosed`
stays `true`. Clicking the tray icon calls a new
`SettingsService.ShowWindow()`, extracted from the summon hotkey's own
show/restore/focus sequence rather than duplicated. A right-click menu
offers "Show Mill"/"Quit". Uses the existing `build/appicon.png`
(1024×1024, full color) via `SetIcon`, not `SetTemplateIcon` — macOS's
monochrome-template-icon convention needs a dedicated small alpha-only
asset Mill doesn't have yet (a named, minor polish gap).

### 5. Per-view hotkeys

Cmd+1 through Cmd+5 jump to a top-level view (Composition/Configure/
Activity/Runs/Spec, matching the sidebar order), via a plain `keydown`
listener in `App.tsx` calling the existing `useAppStore.setView` — no
new navigation mechanism. Deliberately **not** a real OS-level hotkey:
registering one would mean going through `TriggerService`'s claimed-
combo conflict space (the same check the summon hotkey goes through) —
a bigger design surface intentionally not taken on. In-window-only,
active regardless of which element has focus (Cmd+digit isn't a combo
real typing produces, matching browsers'/Slack's own Cmd+1-9
precedent).

### 6. Window/tab/filter state persistence

The dividing line is which layer can even touch the state, not an
arbitrary tier assignment: window geometry is native OS window chrome
with no frontend API at all (only the Go/Wails backend has
`Position()`/`Size()`), so it's Go-side; active view, open tabs, and
list filters are pure React state with no backend meaning, so they're
`localStorage`, the same tier theme/sidebar-collapse already used.

- **Window position/size/maximized** — `settingsservice.go`'s
  `LoadWindowGeometry`/`WatchWindowGeometry`, persisted via the same
  `internal/adapters/settings` store. `main.go` reads saved geometry
  before window creation and applies it via `WebviewWindowOptions`'
  `X`/`Y`/`Width`/`Height`/`StartState`. **Real bug caught before
  shipping**: `InitialPosition` defaults to `WindowCentered` (its zero
  value), so `X`/`Y` are silently ignored unless `InitialPosition:
  WindowXY` is set explicitly — confirmed directly against the SDK
  source. Move/resize/maximize/unmaximize/restore events
  (`events.Common.WindowDidMove` etc.) are debounced (500ms, same
  reasoning `electron-window-state` uses) into one write. **Fullscreen
  is deliberately not tracked** — reapplying persisted X/Y/Width/Height
  to a window last in fullscreen would be meaningless (macOS fullscreen
  occupies its own Space, with real, unresolved multi-monitor
  questions), a named future gap rather than a guess. An off-screen
  guard rejects a persisted position far enough outside any plausible
  display bounds to almost certainly be a stale save from a
  since-disconnected monitor — Wails3, like Wails v2 before it
  (`wailsapp/wails#2739`), has no monitor-identity API, so this is a
  known, accepted limitation, not a full multi-monitor solution.
- **Active view, open Composition/Configure tabs, Activity/Runs
  filters** — `useAppStore` (`shared/store.ts`) wraps its `view` field
  in zustand's own official `persist` middleware, `partialize`d to just
  `view` (workflows/activity/capabilities stay unpersisted — live,
  refetched, or session-only data). `CompositionView.tsx`'s
  `EditorTab[]`/`ConfigureIntegration.tsx`'s `ConnectorTab[]` restore
  only tabs for entities that still exist, via a new shared
  `shared/persistedTabs.ts` helper — Configure additionally restores
  only `'view'` tabs, never `'edit'` (reopening straight into an edit
  form with unsaved typing already gone would look misleadingly "still
  open"). `ActivityView.tsx`'s `sourceFilter`/`outcomeFilter` and
  `RunsView.tsx`'s `kindFilter` persist the same way `sidebarOpen`
  already does. Activity's own run history stays deliberately
  session-only, never persisted (§2.2) — a reload wipes the entries the
  filter needs to render even though the filter *value* persists
  correctly.

### 7. Multi-tenancy seam — declined

No `Scope`/owner concept added to `internal/adapters/settings`'s
`Store` port. Single-user-forever is the honest current assumption, per
Thread 2's four-angle reasoning above. Recorded as researched-and-
declined, not silently unaddressed.

### 8. Deferred: menu-bar/dock presence toggle, trigger-fire notifications

Not built despite being zero-new-dependency (Wails3's own `dock`/
`notifications` packages) — unlike the six items above, neither had a
settled concrete design at the time of this ADR (what should a dock
toggle actually control given Mill has no menu-bar-only mode; what
event should a notification fire on, and how would that interact with
Activity's existing in-app feed). Building either without a design
would be exactly the "config surface for a decision that doesn't exist
yet" trap `.claude/rules/architecture.md` warns against.

## Consequences

- New: `internal/adapters/launchatlogin` (`!server`/`server` split),
  `settingsservice.go` (`SettingsService`), `SettingsView.tsx` UI for
  all of the above.
- `TriggerService` gained `ClaimedCombos()`/`SetReservedCombo` — a
  second consumer of the same injected-seam pattern
  `SetConnectorLookup`/`SetListLookup` already established.
- `main.go` gained `app.Updater.Init(...)` and `app.SystemTray.New()`
  wiring; both compile identically on desktop and `CGO_ENABLED=0`
  server-mode build tags.
- `useAppStore` (`shared/store.ts`) gained zustand's `persist`
  middleware; `shared/persistedTabs.ts` is a new shared helper consumed
  by both Composition and Configure.
- Auto-update is real but inert until Mill has a real tagged-release
  process and a signing key — both named, tracked future work (ADR-0002,
  §1.3), not silently assumed done.
- Deliberately not built: menu-bar/dock toggle, trigger-fire
  notifications (§8), a default working-directory setting (blocked on
  §6), appearance settings beyond light/dark, fullscreen window-state
  tracking.
- A related but distinct spike — Wails3's own `-tags mcp` verification
  server, tried against this work as a desktop-only agent-testing tool
  (confirms window/tray state is agent-drivable but not hotkey-delivery
  specifically) — is recorded in `.claude/skills/run-mill/SKILL.md`,
  not here; it verifies this ADR's mechanisms, it isn't one of them.
