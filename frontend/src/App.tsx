import { useState, useEffect } from 'react'
import {Events, WML} from "@wailsio/runtime";
import {IconButton, Label, NavList, PageLayout, SegmentedControl, Text, useTheme} from "@primer/react";
import {DeviceDesktopIcon, MoonIcon, SidebarCollapseIcon, SidebarExpandIcon, SunIcon} from "@primer/octicons-react";
import SpecView from "./SpecView";
import RunbookView from "./RunbookView";
import ActivityView from "./ActivityView";
import CompositionView from "./CompositionView";
import PlaceholderView from "./PlaceholderView";
import { RunbookService, CapabilitiesService } from "../bindings/github.com/alicoding/mill";
import { useAppStore, viewFor, viewsEqual, statusVariant } from "./store";
import { COLOR_MODE_STORAGE_KEY, SIDEBAR_OPEN_STORAGE_KEY } from "./theme";
import { CAPABILITY_ICON, SPEC_ICON } from "./navIcon";
import styles from "./App.module.css";

const COLOR_MODES = ['light', 'dark', 'auto'] as const

// Show the actual Wails version this project was generated against.
const wailsVersion = "v3.0.0-beta.4";

// import.meta.env.DEV is Vite's own built-in flag, not something Mill
// wires up itself: true only for a real `vite serve` process (what
// `task dev`'s window actually renders through, per devServerURL in its
// logs), false for every `vite build` output regardless of --mode --
// verified directly, not assumed, since that distinction is easy to get
// backwards. This is Mill's answer to "am I looking at a dev build,
// and is it current" (see docs/SPEC.md's dev-build/hot-reload notes).
const isDevBuild = import.meta.env.DEV;

function App() {
  const view = useAppStore((s) => s.view);
  const setView = useAppStore((s) => s.setView);
  const [time, setTime] = useState<string>('Listening for Time event...');
  const actions = useAppStore((s) => s.actions);
  const setActions = useAppStore((s) => s.setActions);
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
  const [loadedAt] = useState(() => new Date().toLocaleTimeString());

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
  const { colorMode, setColorMode, resolvedColorMode } = useTheme();
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
    RunbookService.List().then((list) => setActions(list ?? [])).catch(console.error);
  }, [setActions]);

  useEffect(() => {
    CapabilitiesService.List().then((list) => setCapabilities(list ?? [])).catch(console.error);
  }, [setCapabilities]);

  // Subscribed here, not inside ActivityView/RunbookView, so a hotkey
  // fired while on a different tab is still captured -- the whole point
  // of this feed is answering "did anything run at all" regardless of
  // which page happened to be open, or how the run was triggered. Only
  // the hotkey source pushes via this Go-emitted event -- it's the only
  // one of the three (hotkey/runbook/composition) that fires headlessly;
  // Runbook and Composition runs push directly from their own Run button
  // handlers, since they already resolve synchronously in the browser.
  useEffect(() => {
    return Events.On('hotkey-activity', (evt) => {
      pushActivity({
        id: crypto.randomUUID(),
        time: new Date().toLocaleTimeString(),
        timestamp: Date.now(),
        source: 'hotkey',
        actionID: evt.data.actionID,
        label: actions?.find((a) => a.ID === evt.data.actionID)?.Name ?? evt.data.actionID,
        binding: evt.data.binding,
        success: evt.data.success,
        detail: evt.data.detail,
        result: evt.data.result,
      });
    });
  }, [pushActivity, actions]);

  return (
    <div className="app-shell">
      {isDevBuild && (
        <Label variant="severe" size="small" className={styles.devRibbon}>
          DEV · loaded {loadedAt}
        </Label>
      )}

      {/* Every capability gets a nav entry, built or not (docs/SPEC.md
          §2.2) -- driven by CapabilitiesService's own data so the sidebar
          always reflects Mill's actual shape, not just what's shipped.
          PageLayout.Sidebar, not .Pane: verified directly against the
          compiled CSS that .Pane stacks above/below content below 768px
          (page-scroll-oriented, wrong fit here), while .Sidebar stays a
          persistent side rail at any width -- see docs/SPEC.md. Spec
          stays a fixed, non-capability entry: it's the directory/docs
          page itself, not a product feature with a build status. */}
      <PageLayout className={styles.appBody} containerWidth="full" padding="none" rowGap="none" columnGap="none">
        <PageLayout.Sidebar
          className={sidebarOpen ? styles.sidebar : `${styles.sidebar} ${styles.sidebarCollapsed}`}
          width="small"
          responsiveVariant="default"
          divider="line"
          padding="condensed"
        >
          {/* Wordmark + toggle share one row, both always reachable --
              matches the reference platform's own logo-adjacent collapse
              control rather than Mill's earlier footer-stranded button.
              No wordmark yet in the collapsed rail: Mill has no compact
              logo mark today (only the default Wails placeholder icon,
              see build/appicon.png), so collapsed shows just the toggle,
              centered, rather than fabricating a mark that doesn't exist
              anywhere else in the app. */}
          <div className={styles.sidebarHeader}>
            {sidebarOpen && <Text className={styles.sidebarWordmark}>Mill</Text>}
            <IconButton
              icon={sidebarOpen ? SidebarCollapseIcon : SidebarExpandIcon}
              aria-label={sidebarOpen ? 'Collapse navigation' : 'Expand navigation'}
              size="small"
              variant="invisible"
              onClick={() => setSidebarOpen((v) => !v)}
            />
          </div>
          <div className={styles.sidebarNav}>
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
                        <Label variant={statusVariant(c.Status)} size="small">{c.Status}</Label>
                      </NavList.TrailingVisual>
                    )}
                  </NavList.Item>
                );
              })}
              <NavList.Divider/>
              <NavList.Item
                href="#"
                aria-current={view.kind === 'spec' ? 'page' : undefined}
                aria-label={sidebarOpen ? undefined : 'Spec'}
                title={sidebarOpen ? undefined : 'Spec'}
                onClick={(e) => { e.preventDefault(); setView({ kind: 'spec' }) }}
              >
                <NavList.LeadingVisual><SPEC_ICON/></NavList.LeadingVisual>
                {sidebarOpen && 'Spec'}
              </NavList.Item>
            </NavList>
          </div>
        </PageLayout.Sidebar>

        <PageLayout.Content className="view-pane" padding="none">
          {view.kind === 'runbook' && <RunbookView/>}

          {view.kind === 'activity' && <ActivityView/>}

          {view.kind === 'composition' && <CompositionView/>}

          {view.kind === 'spec' && <SpecView/>}

          {view.kind === 'placeholder' && <PlaceholderView capabilityId={view.capabilityId}/>}
        </PageLayout.Content>
      </PageLayout>

      <hr className={styles.divider}/>
      <footer className={styles.footer}>
        <span className={styles.version}>
          <span>{wailsVersion}</span>
        </span>
        <span className={styles.time}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          <span>{time}</span>
        </span>
        <span className={styles.rightControls}>
          <SegmentedControl aria-label="Color theme" size="small" onChange={(i) => setColorMode(COLOR_MODES[i])}>
            <SegmentedControl.IconButton icon={SunIcon} aria-label="Light theme" selected={colorMode === 'light'} />
            <SegmentedControl.IconButton icon={MoonIcon} aria-label="Dark theme" selected={colorMode === 'dark'} />
            <SegmentedControl.IconButton icon={DeviceDesktopIcon} aria-label="Match system theme" selected={!colorMode || colorMode === 'auto'} />
          </SegmentedControl>
          <a className={styles.docs} data-wml-openURL="https://v3.wails.io" aria-label="Wails documentation">Docs
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="7" y1="17" x2="17" y2="7"/><polyline points="7 7 17 7 17 17"/></svg>
          </a>
        </span>
      </footer>
    </div>
  )
}

export default App
