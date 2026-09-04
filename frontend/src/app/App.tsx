import { useState, useEffect, useRef } from 'react'
import { UndoDeleteToast } from '../shared/UndoDeleteToast'
import { useTranslation } from 'react-i18next'
import {Events, WML} from "@wailsio/runtime";
import {PageLayout} from "@primer/react";
import { StatusStamp } from '../shared/StatusStamp'
import HomeView from "../views/HomeView";
import ActivityView from "../views/ActivityView";
import ReviewView from "../views/ReviewView";
import CompositionView from "../composition/CompositionView";
import ConfigureView from "../configure/ConfigureView";
import { AtlasView } from "../atlas/AtlasView";
import SettingsView from "../views/SettingsView";
import SecretsView from "../views/SecretsView";
import PlaceholderView from "../views/PlaceholderView";
import { CapabilitiesService, ExecutionService, SettingsService } from '../shared/bindings'
import type { BuildInfo } from '../shared/bindings'
import { useAppStore } from "../shared/store";
import { useBootRefresh } from "./useBootRefresh";
import { useDataChangedRouter } from "./useDataChangedRouter";
import { WorkTabShell } from "./WorkTabShell";
import { AppSidebar } from "./AppSidebar";
import { MobileNavToggle } from "./MobileNavToggle";
import { MCPWriteApprovals } from "./MCPWriteApprovals";
import { CommandPalette } from "./CommandPalette";
import { ShortcutsHelpDialog } from "./ShortcutsHelpDialog";
import { WhatsNewDialog } from "./WhatsNewDialog";
import { ClipboardHistoryDialog } from "./ClipboardHistoryDialog";
import { CodingLoopDialog } from "./CodingLoopDialog";
import { DocsSearchDialog } from "./DocsSearchDialog";
import { BuildIdentityBadge } from "./BuildIdentityBadge";
import { NoticePill } from "./NoticePill";
import DocsView from "../views/DocsView";
import { SIDEBAR_OPEN_STORAGE_KEY } from "./theme";
import { pageIconFor, pageLabelFor } from './pageMeta'
import { useMillNavigate } from './useMillNavigate'
import { useBeforeQuitFlush } from './useBeforeQuitFlush'
import { usePluginToolBridge } from './usePluginToolBridge'
import { UnsavedChangesDialog } from './UnsavedChangesDialog'
import { useReviewDeepLink } from './useReviewDeepLink'
import { useSettingsRouteLanding } from './useSettingsRouteLanding'
import { useKeymapDispatch } from './useKeymapDispatch'
import { useBrowserNotify } from './useBrowserNotify'
import { usePluginReviewNotice } from './usePluginReviewNotice'
import styles from "./App.module.css";
import { newLocalID } from '../shared/localId'


// True only inside the Wails native webview (the runtime injects
// window._wails there; a plain browser tab on the server-mode HTTP
// interface has no such global). The desktop window uses
// MacTitleBarHiddenInset (main.go) -- content extends under the hidden
// titlebar and the traffic lights float over the top-left -- so the
// titlebar band below must reserve that strip itself with left inset;
// env(safe-area-inset-*) is always 0 on desktop and cannot cover it
// (a padding-based approach relying on it regresses).
//
// Detection is BuildInfo.Server (Go's own build tag), NOT `'_wails' in
// window` (goal 0021): the Wails JS runtime injects
// _wails in a plain browser tab on the server-mode interface too, so
// that check was true everywhere and native-only chrome leaked into
// server mode. Until GetBuildInfo lands (ms after mount), the shell
// renders the server/browser shape -- the inset appearing a beat late
// on the desktop beats it wrongly appearing at all in a browser.

function App() {
  const { t } = useTranslation('app')
  const view = useAppStore((s) => s.view);
  const setView = useAppStore((s) => s.setView);
  const [time, setTime] = useState<string>(t('shell.listeningForTime'));
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
  // from. Real gap this closes: a desktop app
  // process silently stayed running across an entire session's worth of
  // commits with nothing anywhere flagging it stale (isDevBuild's own
  // ribbon only fires for a live `vite serve`, never for any `go build`
  // output, dev or not).
  const [buildInfo, setBuildInfo] = useState<BuildInfo | null>(null);
  // Mill's own release version (main.go's millVersion), shown in the
  // footer so the running product names itself, not its framework.
  const [appVersion, setAppVersion] = useState('');
  // See the detection comment above App(): Go's build tag, not a
  // window-global sniff; null (not yet fetched) renders the browser
  // shape.
  const isNativeWebview = buildInfo != null && !buildInfo.Server;
  // The titlebar band's own DOM node (Chrome-style tabs-in-titlebar,
  // deliberately adopted), captured via a callback ref on the band div
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

  // The app's window-level keydown handling (docs/goals/0016-keymap-
  // system.md's command dispatcher + goal 0071's bare-`?` shortcuts-
  // help overlay) -- split into its own hook (CLAUDE.md's 500-line
  // convention); see useKeymapDispatch.ts's own header for both
  // listeners' full reasoning.
  useKeymapDispatch();

  // Marks the moment the app's own window-level keydown listeners
  // (useKeymapDispatch, above) are attached, not just when React has
  // committed the shell -- main.tsx's bootstrap() renders this
  // component only after an async plugin-load-gated chain, so a test
  // driving a keyboard shortcut as its FIRST action after page.goto()
  // can race ahead of listener attachment. Effects commit in
  // declaration order, so this fires after useKeymapDispatch's own.
  useEffect(() => {
    document.documentElement.dataset.appReady = 'true';
  }, []);

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

  // The narrow-viewport nav drawer -- distinct from sidebarOpen above
  // (the desktop rail collapse), session-only: always starts closed.
  const [mobileNavOpen, setMobileNavOpen] = useState(false);


  useEffect(() => {
    // Unsubscribe returned like every other Events.On in this file --
    // without it this is the ONE subscription of six here with no
    // cleanup, stacking a duplicate 'time' listener per HMR remount
    // (the exact stray-listener class the build-identity comment above
    // already documents for a reverted mechanism).
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

  useBootRefresh();

  useEffect(() => {
    CapabilitiesService.List().then((list) => setCapabilities(list ?? [])).catch(console.error);
  }, [setCapabilities]);

  useEffect(() => {
    SettingsService.IsIsolatedData().then(setIsIsolatedData).catch(console.error);
  }, []);
  usePluginReviewNotice()

  useEffect(() => {
    SettingsService.GetBuildInfo().then(setBuildInfo).catch(console.error);
    SettingsService.AppVersion().then(setAppVersion).catch(console.error);
  }, []);

  // Only the trigger source pushes activity via this Go-emitted event
  // (still literally named "hotkey-activity" on the wire, kept for
  // event-name compatibility -- see main.go's HotkeyActivity doc
  // comment) -- it's the only one of the two sources that fires
  // headlessly; Composition Run-button clicks push directly from their
  // own handler, since they already resolve synchronously in the
  // browser. The rest of mill-data-changed's routing lives in
  // useDataChangedRouter (below) -- split out at CLAUDE.md's 500-line
  // convention, zero behavior change.
  useDataChangedRouter();

  useMillNavigate(setView);
  useBeforeQuitFlush();
  usePluginToolBridge();
  useReviewDeepLink(setView);
  useSettingsRouteLanding(setView);

  const notifyBrowserTab = useBrowserNotify();

  useEffect(() => {
    return Events.On('hotkey-activity', (evt) => {
      pushActivity({
        id: newLocalID(),
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
        id: newLocalID(),
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
            description: t('pendingApprovalDescription', { workflowLabel: r.workflowLabel, step: r.pending?.nodeTypeLabel || r.pending?.nodeTypeID || t('pendingApprovalStepFallback') }),
            kind: 'guardrail',
          })),
          ...mcpPending.map((w) => ({ key: `mcp-write:${w.id}`, id: w.id, description: w.description, kind: 'mcp-write' })),
        ];

        for (const item of items) {
          if (notifiedIds.current.has(item.key)) continue;
          notifiedIds.current.add(item.key);
          void SettingsService.NotifyPendingApproval(item.id, item.description, item.kind, document.hasFocus()).catch(() => {});
          if (item.kind === 'guardrail') notifyBrowserTab({ dedupeKey: item.id, title: t('browserNotificationTitle'), body: item.description, onClick: () => setView({ kind: 'review' }) });
        }
      });
    };
    refresh();
    const offGuardrail = Events.On('guardrail-pending-changed', refresh);
    const offMCP = Events.On('mcp-write-approval', refresh);
    return () => { offGuardrail(); offMCP(); };
  }, [t, notifyBrowserTab, setView]);

  return (
    <div className="app-shell" data-sidebar-open={sidebarOpen} data-view={view.kind}>
      {/* The titlebar band (Chrome-style tabs-in-titlebar): a real,
          always-present chrome element at the very top of .app-shell,
          above the PageLayout row. Two segments (App.module.css has the
          full reasoning): .titlebarLeft tracks the sidebar column's own
          width (--mill-sidebar-width, index.css); .titlebarTabs is where
          WorkTabShell portals its TabList -- empty space there stays the
          native window's drag handle (--wails-draggable:drag). */}
      <div className={`${styles.titlebar}${isNativeWebview ? ` ${styles.titlebarNative}` : ''}`}>
        <div
          className={sidebarOpen ? styles.titlebarLeft : `${styles.titlebarLeft} ${styles.titlebarLeftCollapsed}`}
          data-testid="titlebar-left"
        >
          {isNativeWebview && <div className={styles.trafficLightInset} aria-hidden="true" />}
          {/* Otherwise this segment is purely the band's sidebar-width
              spacer (the Mill identity lives in the sidebar's own top
              row in both rail states, so nothing else renders up here
              at desktop widths) -- MobileNavToggle is the one exception,
              CSS-visible only below 768px. */}
          <MobileNavToggle onOpen={() => setMobileNavOpen(true)} />
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
      {/* The bare-?/⌘? shortcuts-help overlay (goal 0071): same
          app-level-chrome-mounted-once shape as CommandPalette above,
          renders off the store's helpOpen flag. */}
      <ShortcutsHelpDialog />
      {/* Explicit save mode's leave sheet (goal 0295 S2b): renders off
          the signal store's unsavedLeave, set by the quit handshake. */}
      <UnsavedChangesDialog />
      {/* The update changelog surface (goal 0220 S2): same app-level-
          chrome-mounted-once shape, renders off the store's
          whatsNewOpen flag. */}
      <WhatsNewDialog />
      {/* Clipboard history (goal 0234): same app-level-chrome-mounted-
          once shape, renders off the store's clipboardHistoryOpen
          flag -- opened via the clipboard.history.open command. */}
      <ClipboardHistoryDialog />
      {/* Docs search (goal 0235 S2): same app-level-chrome-mounted-once
          shape, renders off the store's docsSearchOpen flag -- opened
          via the docs.search command, reachable from any view. */}
      <DocsSearchDialog />
      {/* The coding loop (goal 0240 S1): same app-level-chrome-mounted-
          once shape, renders off the store's codingLoopOpen flag --
          opened via the codingLoop.run command. */}
      <CodingLoopDialog />

      {/* Every capability gets a nav entry, built or not (docs/SPEC.md
          §2.2) -- driven by CapabilitiesService's own data so the sidebar
          always reflects Mill's actual shape, not just what's shipped.
          PageLayout.Sidebar, not .Pane: verified directly against the
          compiled CSS that .Pane stacks above/below content below 768px
          (page-scroll-oriented, wrong fit here), while .Sidebar stays a
          persistent side rail at any width -- see docs/SPEC.md. */}
      <PageLayout className={styles.appBody} containerWidth="full" padding="none" rowGap="none" columnGap="none">
        <AppSidebar sidebarOpen={sidebarOpen} setSidebarOpen={setSidebarOpen} mobileNavOpen={mobileNavOpen} setMobileNavOpen={setMobileNavOpen} view={view} setView={setView} capabilities={capabilities} reviewPendingCount={reviewPendingCount} />

        <PageLayout.Content className="view-pane" padding="none">
          {/* The app-wide work-tab strip (docs/SPEC.md §3.8): the
              current section page is the first tab, every open work
              item a tab beside it, surviving sidebar navigation. */}
          <MCPWriteApprovals />
          <WorkTabShell pageLabel={pageLabelFor(view, capabilities, t)} pageIcon={pageIconFor(view)} titlebarSlot={titlebarSlot}>
            {view.kind === 'home' && <HomeView/>}
            {view.kind === 'activity' && <ActivityView/>}
            {view.kind === 'review' && <ReviewView/>}

            {view.kind === 'composition' && <CompositionView/>}

            {view.kind === 'configure' && <ConfigureView key={view.tab} initialTab={view.tab}/>}

            {view.kind === 'atlas' && <AtlasView initialCardID={view.cardID}/>}
            {view.kind === 'docs' && <DocsView initialPage={view.page}/>}

            {view.kind === 'settings' && <SettingsView initialSection={view.section}/>}
            {view.kind === 'secrets' && <SecretsView/>}

            {view.kind === 'placeholder' && <PlaceholderView capabilityId={view.capabilityId}/>}
          </WorkTabShell>
        </PageLayout.Content>
      </PageLayout>

      <hr className={styles.divider}/>
      <footer className={styles.footer}>
        <span className={styles.version}>
          <span>{appVersion ? `Mill v${appVersion}` : 'Mill'}</span>
          {buildInfo?.Revision && (
            <span title={buildInfo.Modified ? t('shell.buildModifiedTooltip') : t('shell.buildRevisionTooltip')}>
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
            <StatusStamp variant="identity" data-testid="isolated-data-badge">
              {t('shell.testDataBadge')}
            </StatusStamp>
          )}
        </span>
        <span className={styles.time}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          <span>{time}</span>
        </span>
        <span className={styles.rightControls}>
          <UndoDeleteToast />
          <NoticePill />
          {/* No external-link arrow: this opens the in-app Docs view,
              and the arrow glyph promised leaving the app. */}
          <a className={styles.docs} href="#" onClick={(e) => { e.preventDefault(); setView({ kind: 'docs' }) }} aria-label={t('shell.docsLinkAriaLabel')} data-testid="footer-docs-link">{t('shell.docsLinkText')}</a>
        </span>
      </footer>
    </div>
  )
}

export default App
