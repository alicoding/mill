import { useState, useEffect, useRef } from 'react'
import {Events, WML} from "@wailsio/runtime";
import {Label, PageLayout, useTheme} from "@primer/react";
import HomeView from "../views/HomeView";
import ActivityView from "../views/ActivityView";
import ReviewView from "../views/ReviewView";
import CompositionView from "../composition/CompositionView";
import ConfigureView from "../configure/ConfigureView";
import SettingsView from "../views/SettingsView";
import PlaceholderView from "../views/PlaceholderView";
import { CapabilitiesService, ExecutionService, SettingsService } from '../shared/bindings'
import type { BuildInfo } from '../shared/bindings'
import { refreshKeybindings, refreshNodeTypes, refreshRequests, refreshWorkflows, useAppStore } from "../shared/store";
import { refreshDecisions, refreshExecEnvs, refreshLists, refreshMCPServers } from "../shared/configureEntityStore";
import { dispatchCommandForEvent } from "../shared/commands";
import { WorkTabShell } from "./WorkTabShell";
import { AppSidebar } from "./AppSidebar";
import { MCPWriteApprovals } from "./MCPWriteApprovals";
import { CommandPalette } from "./CommandPalette";
import { BuildIdentityBadge } from "./BuildIdentityBadge";
import { COLOR_MODE_STORAGE_KEY, SIDEBAR_OPEN_STORAGE_KEY } from "./theme";
import { pageIconFor, pageLabelFor } from './pageMeta'
import styles from "./App.module.css";

// Show the actual Wails version this project was generated against.
const wailsVersion = "v3.0.0-beta.4";

// True only inside the Wails native webview (the runtime injects
// window._wails there; a plain browser tab on the server-mode HTTP
// interface has no such global). The desktop window uses
// MacTitleBarHiddenInset (main.go) -- content extends under the hidden
// titlebar and the traffic lights float over the top-left -- so the
// titlebar band below must reserve that strip itself with left inset;
// env(safe-area-inset-*) is always 0 on desktop and cannot cover it
// (real regression caught live after the old padding-based approach
// relied on it).
//
// Detection is BuildInfo.Server (Go's own build tag), NOT `'_wails' in
// window` -- found live (goal 0021): the Wails JS runtime injects
// _wails in a plain browser tab on the server-mode interface too, so
// that check was true everywhere and native-only chrome leaked into
// server mode. Until GetBuildInfo lands (ms after mount), the shell
// renders the server/browser shape -- the inset appearing a beat late
// on the desktop beats it wrongly appearing at all in a browser.

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
  // See the detection comment above App(): Go's build tag, not a
  // window-global sniff; null (not yet fetched) renders the browser
  // shape.
  const isNativeWebview = buildInfo != null && !buildInfo.Server;
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
    // Unsubscribe returned like every other Events.On in this file --
    // audit-caught (2026-08-11): this was the ONE subscription of six
    // here with no cleanup, stacking a duplicate 'time' listener per
    // HMR remount (the exact stray-listener class the build-identity
    // comment above already documents for a reverted mechanism).
    const off = Events.On('time', (timeValue) => {
      // On a narrow screen the full RFC1123 stamp is too wide for the footer, so
      // show just the clock time there (matching the CSS breakpoint).
      const full = timeValue.data;
      const compact = (full.match(/\d{1,2}:\d{2}:\d{2}/) || [full])[0];
      setTime(window.matchMedia('(max-width: 640px)').matches ? compact : full);
    });
    // Reload WML so it picks up the wml tags
    WML.Reload();
    return off;
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
  // Live sync (docs/adr/0025 + goal 0017): every direct-mutation
  // service now emits this, not just mcpsvc -- one refresher per
  // entity kind, each routed to its own store (shared/store.ts's
  // workflows/requests, shared/configureEntityStore.ts's lists/
  // decisions/mcpServers/execEnvs). Was previously misrouted for
  // 'list'/'mcpserver' (refreshRequests()+refreshWorkflows(), neither
  // of which holds either); 'decision'/'execenv' are new entity
  // strings. 'guardrail-rule' has no shared-store consumer here --
  // useGuardrailBadges/the Guardrails section subscribe to it directly.
  useEffect(() => {
    return Events.On('mill-data-changed', (evt) => {
      const entity = (evt.data as { entity?: string })?.entity
      if (entity === 'workflow' || entity === 'run') void refreshWorkflows()
      if (entity === 'request') void refreshRequests()
      if (entity === 'list') void refreshLists()
      if (entity === 'mcpserver') void refreshMCPServers()
      if (entity === 'decision') void refreshDecisions()
      if (entity === 'execenv') void refreshExecEnvs()
    })
  }, [])

  // docs/adr/0033: the Quick Panel's "Open Settings" row (a separate
  // Wails window, own React tree -- it can't call setView directly)
  // asks the main window to navigate via SettingsService.OpenMainWindow,
  // which shows/focuses this window and emits this event. Empty-string
  // view (the panel's "Open Mill" row) means "just show the window,"
  // no navigation. 'review' is the floating approval prompt's own
  // "Open in Mill" row for a guardrail/human-review park
  // (docs/goals/0023 item 1, app/ApprovalPrompt.tsx) -- same mechanism,
  // one more target.
  useEffect(() => {
    return Events.On('mill-navigate', (evt) => {
      const target = evt.data as string;
      if (target === 'settings') setView({ kind: 'settings' });
      if (target === 'review') setView({ kind: 'review' });
    });
  }, [setView]);

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

  // A missed (timed-out), denied, or cancelled MCP write is no longer
  // traceless (docs/goals/0005-pending-attention-model.md item 3):
  // pushed into the same Activity feed under the 'mcp-write' source,
  // same push shape as the hotkey-activity handler above. workflowID/
  // result now carry real content (docs/goals/0026 item 7 -- "so what I
  // can do and nothing I can do"): workflowID is set only when the
  // gated tool named an existing target (update/publish/delete_workflow;
  // empty for import_* tools, which mint a new entity), which is what
  // makes ActivityView's existing WorkflowHoverPreview jump-to-workflow
  // icon appear for this row, same as any run row; result is what the
  // row's existing canExpand/expand-to-detail mechanism shows.
  useEffect(() => {
    return Events.On('mcp-write-activity', (evt) => {
      pushActivity({
        id: crypto.randomUUID(),
        time: new Date().toLocaleTimeString(),
        timestamp: Date.now(),
        source: 'mcp-write',
        workflowID: evt.data.workflowID ?? '',
        label: evt.data.description,
        success: false,
        detail: evt.data.outcome,
        result: evt.data.result ?? '',
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
  //
  // Away-user attention layer (docs/adr/0032 §3, sharpened by
  // docs/goals/0023-attention-escalation.md items 1/2/4), folded into
  // the same effect since it reads the same two lists: the total count
  // mirrors to the dock badge on every change, and each NEW pending
  // item (an id not seen on a previous refresh) is reported to the
  // backend exactly once -- notifiedIds tracks what's already been
  // reported so a later re-fetch of the same still-pending item never
  // re-fires either call below.
  //
  // The presence decision itself (present vs. away) moved BACKEND-side
  // (SettingsService.NotifyPendingApproval's own isAway) -- this effect
  // only supplies its own document.hasFocus() reading and always calls
  // it for every new item; the backend decides whether that's actually
  // "present" (focused AND recently-active) or "away" (idle past the
  // configured threshold, or unfocused), fixing the previously-observed
  // focused-but-idle suppression bug a frontend-only gate couldn't see.
  // The cross-device forward moved to composition (docs/adr/0035): a
  // decision-parked system event now reaches the seeded "Example: Forward
  // pending approvals" workflow through TriggerService, not a call from
  // here -- ForwardPendingApproval's own private send path is deleted.
  const [reviewPendingCount, setReviewPendingCount] = useState(0);
  const notifiedIds = useRef<Set<string>>(new Set());
  useEffect(() => {
    const refresh = () => {
      Promise.all([
        ExecutionService.ListRuns().then((runs) => (runs ?? []).filter((r) => r.pending)).catch(() => []),
        SettingsService.PendingMCPWrites().then((p) => p ?? []).catch(() => []),
      ]).then(([guardrailPending, mcpPending]) => {
        setReviewPendingCount(guardrailPending.length + mcpPending.length);
        void SettingsService.SetPendingBadge(guardrailPending.length + mcpPending.length).catch(() => {});

        const items: { key: string; id: string; description: string; kind: string }[] = [
          ...guardrailPending.map((r) => ({
            key: `guardrail:${r.runID}`,
            id: r.runID,
            description: `${r.workflowLabel}: ${r.pending?.nodeTypeLabel || r.pending?.nodeTypeID || 'a step'} needs approval`,
            kind: 'guardrail',
          })),
          ...mcpPending.map((w) => ({ key: `mcp-write:${w.id}`, id: w.id, description: w.description, kind: 'mcp-write' })),
        ];

        for (const item of items) {
          if (notifiedIds.current.has(item.key)) continue;
          notifiedIds.current.add(item.key);
          void SettingsService.NotifyPendingApproval(item.id, item.description, item.kind, document.hasFocus()).catch(() => {});
        }
      });
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
      <div className={`${styles.titlebar}${isNativeWebview ? ` ${styles.titlebarNative}` : ''}`}>
        <div
          className={sidebarOpen ? styles.titlebarLeft : `${styles.titlebarLeft} ${styles.titlebarLeftCollapsed}`}
          data-testid="titlebar-left"
        >
          {isNativeWebview && <div className={styles.trafficLightInset} aria-hidden="true" />}
          {/* No content up here anymore (owner refinement: the Mill
              identity lives in the sidebar's top row in BOTH states, so
              it never moves when the rail collapses) -- this segment is
              now purely the band's sidebar-width spacer: it carries the
              divider line up through the band and, on native, the
              traffic-light clearance. */}
        </div>
        <div
          ref={setTitlebarSlot}
          className={styles.titlebarTabs}
          data-testid="titlebar-tabs"
        />
        {/* Build-identity badge -- one glance answers "which build is
            this, and is it live." Extracted to BuildIdentityBadge.tsx
            (goal 0019). Lives IN the band's right segment as flex
            content, not a fixed overlay -- see App.module.css's
            .devRibbon comment for the click-interception bug that
            forced this. */}
        <div className={styles.titlebarRight}>
          <BuildIdentityBadge buildInfo={buildInfo} />
        </div>
      </div>
      {/* The ⌘K command palette (docs/goals/0015): renders off the
          store's paletteOpen flag regardless of which page/work tab is
          active, same "app-level chrome, mounted once" pattern as
          MCPWriteApprovals below. */}
      <CommandPalette />

      {/* Every capability gets a nav entry, built or not (docs/SPEC.md
          §2.2) -- driven by CapabilitiesService's own data so the sidebar
          always reflects Mill's actual shape, not just what's shipped.
          PageLayout.Sidebar, not .Pane: verified directly against the
          compiled CSS that .Pane stacks above/below content below 768px
          (page-scroll-oriented, wrong fit here), while .Sidebar stays a
          persistent side rail at any width -- see docs/SPEC.md. */}
      <PageLayout className={styles.appBody} containerWidth="full" padding="none" rowGap="none" columnGap="none">
        <AppSidebar sidebarOpen={sidebarOpen} setSidebarOpen={setSidebarOpen} view={view} setView={setView} capabilities={capabilities} reviewPendingCount={reviewPendingCount} />

        <PageLayout.Content className="view-pane" padding="none">
          {/* The app-wide work-tab strip (docs/SPEC.md §3.8): the
              current section page is the first tab, every open work
              item a tab beside it, surviving sidebar navigation. */}
          <MCPWriteApprovals />
          <WorkTabShell pageLabel={pageLabelFor(view, capabilities)} pageIcon={pageIconFor(view)} titlebarSlot={titlebarSlot}>
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
          {/* Instance-identity info lives with instance-identity info:
              this badge floated as a fixed ribbon twice, and BOTH spots
              it picked got claimed by real chrome (first the titlebar
              band's toggle, then the sidebar top row's) -- caught each
              time by the band-tracking e2e's intercepted clicks. The
              footer never moves. */}
          {isIsolatedData && (
            <Label variant="accent" size="small" data-testid="isolated-data-badge">
              TEST DATA
            </Label>
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
