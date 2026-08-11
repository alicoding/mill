import { useState, useEffect } from 'react'
import {Events, WML} from "@wailsio/runtime";
import {CounterLabel, IconButton, Label, NavList, PageLayout, Text, useTheme} from "@primer/react";
import {DotFillIcon, GearIcon, SidebarCollapseIcon, SidebarExpandIcon} from "@primer/octicons-react";
import HomeView from "../views/HomeView";
import ActivityView from "../views/ActivityView";
import ReviewView from "../views/ReviewView";
import CompositionView from "../composition/CompositionView";
import ConfigureView from "../configure/ConfigureView";
import SettingsView from "../views/SettingsView";
import PlaceholderView from "../views/PlaceholderView";
import { CapabilitiesService, ExecutionService, SettingsService } from '../shared/bindings'
import type { BuildInfo } from '../shared/bindings'
import { refreshKeybindings, refreshNodeTypes, refreshRequests, refreshWorkflows, useAppStore, viewFor, viewsEqual, statusDotColor } from "../shared/store";
import type { View } from "../shared/store";
import { dispatchCommandForEvent } from "../shared/commands";
import { WorkTabShell } from "./WorkTabShell";
import { MCPWriteApprovals } from "./MCPWriteApprovals";
import { CommandPalette } from "./CommandPalette";
import { BuildIdentityBadge } from "./BuildIdentityBadge";
import { COLOR_MODE_STORAGE_KEY, SIDEBAR_OPEN_STORAGE_KEY } from "./theme";
import { CAPABILITY_ICON } from "./navIcon";
import styles from "./App.module.css";

// Show the actual Wails version this project was generated against.
const wailsVersion = "v3.0.0-beta.4";

// The strip's first tab names the current sidebar section -- the "go
// back to the page under the tabs" affordance.
function pageLabelFor(view: View, capabilities: { ID: string; Label: string; NavLabel: string }[]): string {
  switch (view.kind) {
    case 'home': return 'Home'
    case 'composition': return 'Workflows'
    case 'configure': return 'Configure'
    case 'activity': return 'Activity'
    case 'review': return 'Review'
    case 'settings': return 'Settings'
    case 'placeholder': {
      const cap = capabilities.find((c) => c.ID === view.capabilityId)
      return cap ? (cap.NavLabel || cap.Label) : 'Overview'
    }
  }
}

// True only inside the Wails native webview (the runtime injects
// window._wails there; a plain browser tab on the server-mode HTTP
// interface has no such global). The desktop window uses
// MacTitleBarHiddenInset (main.go) -- content extends under the hidden
// titlebar and the traffic lights float over the top-left -- so the
// titlebar band below must reserve that strip itself with left inset;
// env(safe-area-inset-*) is always 0 on desktop and cannot cover it
// (real regression caught live after the old padding-based approach
// relied on it).
const IS_NATIVE_WEBVIEW = typeof window !== "undefined" && "_wails" in window;

function App() {
  const view = useAppStore((s) => s.view);
  const setView = useAppStore((s) => s.setView);
  const [time, setTime] = useState<string>('Listening for Time event...');
  // Whether this instance is running against an isolated settings/
  // execution-db path (MILL_SETTINGS_PATH set -- every e2e run already
  // does this, and it's the same signal a LAN/Tailscale-reachable
  // server-mode instance should set) rather than the real desktop app's
  // one default data file. Surfaced as a visible badge below so it's
  // never ambiguous which instance -- real data or isolated test data --
  // you're looking at (settingsservice.go's IsIsolatedData doc comment
  // has the full reasoning).
  const [isIsolatedData, setIsIsolatedData] = useState(false);
  // Which commit this specific running instance was actually built
  // from -- distinct from wailsVersion (which Wails SDK the project was
  // generated against, a constant). Real gap this closes: a desktop app
  // process silently stayed running across an entire session's worth of
  // commits with nothing anywhere flagging it stale (isDevBuild's own
  // ribbon only fires for a live `vite serve`, never for any `go build`
  // output, dev or not).
  const [buildInfo, setBuildInfo] = useState<BuildInfo | null>(null);
  // The titlebar band's own DOM node (Chrome-style tabs-in-titlebar,
  // owner-requested), captured via a callback ref on the band div
  // rendered below. WorkTabShell portals its TabList/overflow markup
  // into it -- a plain DOM node, not a ref object, since createPortal
  // needs the actual element and this crosses a component boundary.
  // null on the very first render (the callback ref fires during
  // commit, one tick after); WorkTabShell simply skips the portal
  // until it's set, settling before anything can observe it.
  const [titlebarSlot, setTitlebarSlot] = useState<HTMLDivElement | null>(null);
  const workflows = useAppStore((s) => s.workflows);
  const pushActivity = useAppStore((s) => s.pushActivity);
  const setCapabilities = useAppStore((s) => s.setCapabilities);
  const capabilities = useAppStore((s) => s.capabilities);
  // Captured once per mount -- correct for a Go-triggered relaunch (Go
  // isn't hot-reloadable, so a Go change forces a fresh mount) but not
  // for a frontend-only HMR edit, which updates live without remounting.
  // A vite:afterUpdate-based "true last build" version was tried and
  // reverted: subscribing to it from App.tsx, the same file that keeps
  // getting hot-edited, hit a real bug where React Fast Refresh didn't
  // reliably clean up the old listener across repeated hot-swaps of this
  // module, leaving stray listeners firing on unrelated updates. Not
  // worth chasing further for a dev-convenience ribbon -- see SPEC.md.

  // The keymap system's one window keydown listener (docs/goals/0016-
  // keymap-system.md): resolves a pressed combo against every
  // command's current EFFECTIVE binding (shared/commands.ts's
  // dispatchCommandForEvent -- default, or this store's own
  // keybindingOverrides if the owner rebound it in Settings) and runs
  // the first match. This is the direct successor to the old, hardcoded
  // Cmd+1-4/Cmd+, VIEW_HOTKEYS handler -- those four are now just
  // ordinary commands (view.composition/configure/activity/review,
  // settings.open) in COMMANDS, dispatched the exact same way, not a
  // second parallel handler. Deliberately in-window-only, not a global
  // OS-level hotkey, same reasoning the old handler already had: plain
  // browser keydown handling is the reversible/safer default, distinct
  // from TriggerService's real OS-level golang.design/x/hotkey
  // registration (§3.4) that per-workflow and summon hotkeys use.
  // Active regardless of which element has focus (comboFromEvent
  // itself requires Cmd or Ctrl, never a bare key a text field would
  // otherwise consume) -- matches browsers'/Slack's own Cmd+1-9
  // tab-switching precedent.
  const keybindingOverrides = useAppStore((s) => s.keybindingOverrides);
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (dispatchCommandForEvent(e, keybindingOverrides)) {
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [keybindingOverrides]);

  // Icon-rail collapse (narrow persistent strip, not full hide/show) is a
  // well-established pattern -- but Primer genuinely ships none of its
  // mechanics. Checked exhaustively, not assumed: grepped @primer/react's
  // compiled output for "collapse" (zero hits outside icon names), and
  // read PageLayout's, SplitPageLayout's, and NavList's own .d.ts files --
  // PageLayout.Sidebar/SplitPageLayout.Sidebar expose only a plain
  // `hidden` boolean (full show/hide, no rail-width state), and NavList
  // has no icon-only/collapsed rendering mode of its own. GitHub.com's own
  // product sidebar (the actual visual precedent for this) is built on
  // GitHub-internal components that were never published to @primer/react
  // -- so this rail is hand-built on Primer's real primitives (NavList,
  // NavList.LeadingVisual, IconButton) the same way GitHub's own is
  // presumably hand-built on top of Primer internally, not something
  // @primer/react ships pre-made. Sidebar state is now a width toggle, not
  // a visibility toggle: the sidebar is never fully hidden, it only
  // narrows to an icon rail, so the one toggle button (in the sidebar's
  // own header, next to the wordmark) stays reachable in both states --
  // no second "expand" control stranded elsewhere. Persisted (not just
  // session state) since a UI layout preference, not domain data, is
  // exactly what localStorage is for -- Mill's real settings store
  // (internal/adapters/settings) is reserved for actual domain state like
  // hotkey bindings and composed workflows.
  const [sidebarOpen, setSidebarOpen] = useState(() => localStorage.getItem(SIDEBAR_OPEN_STORAGE_KEY) !== 'false');
  useEffect(() => {
    localStorage.setItem(SIDEBAR_OPEN_STORAGE_KEY, String(sidebarOpen));
  }, [sidebarOpen]);

  // colorMode/setColorMode/resolvedColorMode come from Primer's own
  // useTheme() -- light/dark/auto(=system) is a built-in ThemeProvider
  // capability (colorMode="auto" already tracks prefers-color-scheme
  // reactively, confirmed directly against its source), not something
  // to hand-roll a media-query listener for.
  const { colorMode, resolvedColorMode } = useTheme();
  useEffect(() => {
    localStorage.setItem(COLOR_MODE_STORAGE_KEY, colorMode ?? 'auto');
    // Primer's own data-color-mode/data-light-theme/data-dark-theme
    // attributes (which its generated CSS custom properties are scoped
    // to -- e.g. [data-color-mode="dark"][data-dark-theme="dark"], not
    // :root) land on a wrapper <div> ThemeProvider renders *inside*
    // <body>, confirmed directly against the live DOM -- so html/body
    // themselves (above/outside that div) can't see those tokens. This
    // mirrors the same three attributes onto <html> so the couple of
    // truly-global rules in index.css (page background, base text
    // color) can use Primer's real tokens too, instead of a second,
    // hardcoded color source that silently stops matching the theme the
    // moment light mode is real. Primer's own dayScheme/nightScheme
    // defaults ('light'/'dark', unchanged here) are what data-light-
    // theme/data-dark-theme need to match.
    const root = document.documentElement;
    root.dataset.colorMode = colorMode ?? 'auto';
    root.dataset.lightTheme = 'light';
    root.dataset.darkTheme = 'dark';
    // color-scheme is native browser chrome (scrollbars, form control
    // rendering) -- Primer's tokens don't drive this, so it's set here
    // from the *resolved* mode (light/dark, with 'auto' already settled
    // by Primer's own system-preference detection), not the raw
    // colorMode which can itself be 'auto'.
    if (resolvedColorMode) root.style.colorScheme = resolvedColorMode;
  }, [colorMode, resolvedColorMode]);

  useEffect(() => {
    Events.On('time', (timeValue) => {
      // On a narrow screen the full RFC1123 stamp is too wide for the footer, so
      // show just the clock time there (matching the CSS breakpoint).
      const full = timeValue.data;
      const compact = (full.match(/\d{1,2}:\d{2}:\d{2}/) || [full])[0];
      setTime(window.matchMedia('(max-width: 640px)').matches ? compact : full);
    });
    // Reload WML so it picks up the wml tags
    WML.Reload();
  }, []);

  useEffect(() => {
    // The shared server-data trio the store owns (workflows for the
    // sidebar/hotkey handler, nodeTypes/requests for the app-wide
    // work-tab shell's editors) -- fetched once here, refetched by
    // whichever surface mutates them.
    void refreshWorkflows();
    void refreshNodeTypes();
    void refreshRequests();
    void refreshKeybindings();
  }, []);

  useEffect(() => {
    CapabilitiesService.List().then((list) => setCapabilities(list ?? [])).catch(console.error);
  }, [setCapabilities]);

  useEffect(() => {
    SettingsService.IsIsolatedData().then(setIsIsolatedData).catch(console.error);
  }, []);

  useEffect(() => {
    SettingsService.GetBuildInfo().then(setBuildInfo).catch(console.error);
  }, []);

  // Subscribed here, not inside ActivityView/CompositionView, so a
  // headless trigger fired while on a different tab is still captured --
  // the whole point of this feed is answering "did anything run at all"
  // regardless of which page happened to be open, or how the run was
  // triggered. Only the trigger source pushes via this Go-emitted event
  // (still literally named "hotkey-activity" on the wire, kept for event-
  // name compatibility -- see main.go's HotkeyActivity doc comment) --
  // it's the only one of the two sources that fires headlessly;
  // Composition Run-button clicks push directly from their own handler,
  // since they already resolve synchronously in the browser.
  // Live sync for MCP-driven authoring (docs/adr/0025): when an
  // external LLM changes data through Mill's MCP server, the open
  // window refreshes it immediately -- §1's what-you-see-is-what-I-see
  // thesis running in both directions. One coarse refresh per entity
  // kind; the stores are cheap to re-fetch at Mill's scale.
  useEffect(() => {
    return Events.On('mill-data-changed', (evt) => {
      const entity = (evt.data as { entity?: string })?.entity
      if (entity === 'workflow' || entity === 'run') void refreshWorkflows()
      if (entity === 'request') void refreshRequests()
      if (entity === 'list' || entity === 'mcpserver') { void refreshRequests(); void refreshWorkflows() }
    })
  }, [])

  useEffect(() => {
    return Events.On('hotkey-activity', (evt) => {
      pushActivity({
        id: crypto.randomUUID(),
        time: new Date().toLocaleTimeString(),
        timestamp: Date.now(),
        source: 'trigger',
        workflowID: evt.data.workflowID,
        label: workflows?.find((w) => w.ID === evt.data.workflowID)?.Label ?? evt.data.workflowID,
        binding: evt.data.binding,
        success: evt.data.success,
        detail: evt.data.detail,
        result: evt.data.result,
      });
    });
  }, [pushActivity, workflows]);

  // A missed (timed-out) or denied MCP write is no longer traceless
  // (docs/goals/0005-pending-attention-model.md item 3): pushed into
  // the same Activity feed under the 'mcp-write' source, same push
  // shape as the hotkey-activity handler above -- no workflowID/binding
  // of its own, just what was denied/missed and why.
  useEffect(() => {
    return Events.On('mcp-write-activity', (evt) => {
      pushActivity({
        id: crypto.randomUUID(),
        time: new Date().toLocaleTimeString(),
        timestamp: Date.now(),
        source: 'mcp-write',
        workflowID: '',
        label: evt.data.description,
        success: false,
        detail: evt.data.outcome,
        result: '',
      });
    });
  }, [pushActivity]);

  // Review sidebar pending-count badge (docs/goals/0002 item 3, folded
  // into 0005's unified event research): guardrail parks/resolves and
  // MCP write requests are the two pending-attention sources; count =
  // guardrail-pending + mcp-write-pending, refetched on their own event
  // rather than polled. The count itself is derived from ListRuns
  // (the same RPC ReviewView already filters on r.pending) and
  // PendingMCPWrites (MCPWriteApprovals' own RPC) -- no new backend
  // surface needed for a number that already exists two ways.
  const [reviewPendingCount, setReviewPendingCount] = useState(0);
  useEffect(() => {
    const refresh = () => {
      Promise.all([
        ExecutionService.ListRuns().then((runs) => (runs ?? []).filter((r) => r.pending).length).catch(() => 0),
        SettingsService.PendingMCPWrites().then((p) => (p ?? []).length).catch(() => 0),
      ]).then(([guardrailPending, mcpPending]) => setReviewPendingCount(guardrailPending + mcpPending));
    };
    refresh();
    const offGuardrail = Events.On('guardrail-pending-changed', refresh);
    const offMCP = Events.On('mcp-write-approval', refresh);
    return () => { offGuardrail(); offMCP(); };
  }, []);

  return (
    <div className="app-shell" data-sidebar-open={sidebarOpen}>
      {/* The titlebar band (Chrome-style tabs-in-titlebar, owner-
          requested: "Chrome has the tab system at the very top -- we
          should adopt that pattern"). A real, always-present chrome
          element at the very top of .app-shell, above the PageLayout
          row -- not padding reserving empty space the way the old
          .app-shell--native-titlebar rule did.

          Two segments (App.module.css has the full reasoning for the
          fix this is): .titlebarLeft is the sidebar column's own strip
          of the band -- tracks the real sidebar's width via the shared
          --mill-sidebar-width custom property (index.css), holds the
          native traffic-light inset, the collapse/expand toggle (moved
          up from the sidebar's own now-deleted header), and the
          wordmark. .titlebarTabs is where WorkTabShell (rendered below,
          inside PageLayout.Content) portals its TabList + overflow menu
          -- empty space there stays the native window's drag handle
          (--wails-draggable:drag, App.module.css). */}
      <div className={`${styles.titlebar}${IS_NATIVE_WEBVIEW ? ` ${styles.titlebarNative}` : ''}`}>
        <div
          className={sidebarOpen ? styles.titlebarLeft : `${styles.titlebarLeft} ${styles.titlebarLeftCollapsed}`}
          data-testid="titlebar-left"
        >
          {IS_NATIVE_WEBVIEW && <div className={styles.trafficLightInset} aria-hidden="true" />}
          <IconButton
            icon={sidebarOpen ? SidebarCollapseIcon : SidebarExpandIcon}
            aria-label={sidebarOpen ? 'Collapse navigation' : 'Expand navigation'}
            size="small"
            variant="invisible"
            className={styles.titlebarSidebarToggle}
            onClick={() => setSidebarOpen((v) => !v)}
          />
          {sidebarOpen && <Text className={styles.titlebarWordmark}>Mill</Text>}
        </div>
        <div
          ref={setTitlebarSlot}
          className={styles.titlebarTabs}
          data-testid="titlebar-tabs"
        />
      </div>
      {/* Build-identity badge -- one glance answers "which build is
          this, and is it live." Extracted to BuildIdentityBadge.tsx
          (goal 0019); its own doc comment carries the full reasoning. */}
      <BuildIdentityBadge buildInfo={buildInfo} />
      {/* The ⌘K command palette (docs/goals/0015): renders off the
          store's paletteOpen flag regardless of which page/work tab is
          active, same "app-level chrome, mounted once" pattern as
          MCPWriteApprovals below. */}
      <CommandPalette />
      {isIsolatedData && (
        <Label variant="accent" size="small" className={styles.isolatedDataRibbon} data-testid="isolated-data-badge">
          TEST DATA
        </Label>
      )}

      {/* Every capability gets a nav entry, built or not (docs/SPEC.md
          §2.2) -- driven by CapabilitiesService's own data so the sidebar
          always reflects Mill's actual shape, not just what's shipped.
          PageLayout.Sidebar, not .Pane: verified directly against the
          compiled CSS that .Pane stacks above/below content below 768px
          (page-scroll-oriented, wrong fit here), while .Sidebar stays a
          persistent side rail at any width -- see docs/SPEC.md. */}
      <PageLayout className={styles.appBody} containerWidth="full" padding="none" rowGap="none" columnGap="none">
        <PageLayout.Sidebar
          className={styles.sidebar}
          width="small"
          responsiveVariant="default"
          divider="line"
          padding="condensed"
        >
          {/* The wordmark + collapse toggle that used to render here (a
              .sidebarHeader row) moved up into the titlebar band's own
              left segment above -- the fix for the reported flaw (they
              used to sit orphaned below the band, and collapsing the
              sidebar moved nothing up there). .sidebarNav is now the
              sidebar's first real content. */}
          <div className={styles.sidebarNav} data-testid="sidebar-nav">
            <NavList>
              {capabilities.map((c) => {
                const target = viewFor(c);
                const label = c.NavLabel || c.Label;
                const NavIcon = CAPABILITY_ICON[c.ID];
                return (
                  <NavList.Item
                    key={c.ID}
                    href="#"
                    aria-current={viewsEqual(view, target) ? 'page' : undefined}
                    aria-label={sidebarOpen ? undefined : label}
                    title={sidebarOpen ? undefined : label}
                    onClick={(e) => { e.preventDefault(); setView(target) }}
                  >
                    {NavIcon && <NavList.LeadingVisual><NavIcon/></NavList.LeadingVisual>}
                    {sidebarOpen && label}
                    {sidebarOpen && (
                      <NavList.TrailingVisual>
                        {c.ID === 'capability-review' && reviewPendingCount > 0 && (
                          <CounterLabel
                            data-testid="review-pending-count"
                            aria-label={`${reviewPendingCount} pending in Review`}
                          >
                            {reviewPendingCount}
                          </CounterLabel>
                        )}
                        <span title={c.Status} className={styles.statusDot}>
                          <DotFillIcon
                            size={12}
                            fill={statusDotColor(c.Status)}
                            aria-label={c.Status}
                          />
                        </span>
                      </NavList.TrailingVisual>
                    )}
                  </NavList.Item>
                );
              })}
            </NavList>
          </div>

          {/* Settings pulled out of the NavList entirely, into a bottom-
              anchored footer slot -- Notion/Slack's own pattern for
              app-level config vs. content destinations (docs/SPEC.md
              §3.5). Not a capability (no build status/SPEC section of
              its own), so it isn't driven by CapabilitiesService.List()
              the way the rows above are -- a fixed control. */}
          <div className={styles.sidebarFooter}>
            <IconButton
              icon={GearIcon}
              aria-label="Settings"
              size="small"
              variant="invisible"
              onClick={() => setView({ kind: 'settings' })}
            />
          </div>
        </PageLayout.Sidebar>

        <PageLayout.Content className="view-pane" padding="none">
          {/* The app-wide work-tab strip (docs/SPEC.md §3.8): the
              current section page is the first tab, every open work
              item a tab beside it, surviving sidebar navigation. */}
          <MCPWriteApprovals />
          <WorkTabShell pageLabel={pageLabelFor(view, capabilities)} titlebarSlot={titlebarSlot}>
            {view.kind === 'home' && <HomeView/>}

            {view.kind === 'activity' && <ActivityView/>}
            {view.kind === 'review' && <ReviewView/>}

            {view.kind === 'composition' && <CompositionView/>}

            {view.kind === 'configure' && <ConfigureView/>}

            {view.kind === 'settings' && <SettingsView/>}

            {view.kind === 'placeholder' && <PlaceholderView capabilityId={view.capabilityId}/>}
          </WorkTabShell>
        </PageLayout.Content>
      </PageLayout>

      <hr className={styles.divider}/>
      <footer className={styles.footer}>
        <span className={styles.version}>
          <span>{wailsVersion}</span>
          {buildInfo?.Revision && (
            <span title={buildInfo.Modified ? 'Built with uncommitted changes' : 'Commit this build was built from'}>
              · {buildInfo.Revision.slice(0, 7)}{buildInfo.Modified && '*'}
            </span>
          )}
        </span>
        <span className={styles.time}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          <span>{time}</span>
        </span>
        <span className={styles.rightControls}>
          <a className={styles.docs} data-wml-openURL="https://v3.wails.io" aria-label="Wails documentation">Docs
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="7" y1="17" x2="17" y2="7"/><polyline points="7 7 17 7 17 17"/></svg>
          </a>
        </span>
      </footer>
    </div>
  )
}

export default App
