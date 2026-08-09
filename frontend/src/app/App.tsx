import { useState, useEffect } from 'react'
import {Events, WML} from "@wailsio/runtime";
import {IconButton, Label, NavList, PageLayout, Text, useTheme} from "@primer/react";
import {DotFillIcon, GearIcon, SidebarCollapseIcon, SidebarExpandIcon} from "@primer/octicons-react";
import SpecView from "../views/SpecView";
import ActivityView from "../views/ActivityView";
import CompositionView from "../composition/CompositionView";
import ConfigureView from "../configure/ConfigureView";
import RunsView from "../views/RunsView";
import SettingsView from "../views/SettingsView";
import PlaceholderView from "../views/PlaceholderView";
import { CompositionService, CapabilitiesService } from "../../bindings/github.com/alicoding/mill";
import { useAppStore, viewFor, viewsEqual, statusDotColor } from "../shared/store";
import type { View } from "../shared/store";
import { COLOR_MODE_STORAGE_KEY, SIDEBAR_OPEN_STORAGE_KEY } from "./theme";
import { CAPABILITY_ICON, SPEC_ICON } from "./navIcon";
import styles from "./App.module.css";

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
  const workflows = useAppStore((s) => s.workflows);
  const setWorkflows = useAppStore((s) => s.setWorkflows);
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

  // Per-view hotkeys (task #9, docs/SPEC.md §3.7) -- Cmd+1 through
  // Cmd+5 jump straight to a top-level view, matching the sidebar's own
  // order (Composition/Configure lead, Activity/Runs follow, Spec is
  // always last). Deliberately in-window-only, not a global OS-level
  // hotkey: this reuses plain browser keydown handling, the reversible/
  // safer default named directly in the session goal that built this,
  // distinct from TriggerService's real OS-level golang.design/x/hotkey
  // registration (§3.4) that per-workflow and summon hotkeys use --
  // registering these globally too would mean checking them against
  // TriggerService's own claimed-combo conflict space, a bigger design
  // surface this pass deliberately doesn't take on. Matches
  // browsers'/Slack's own Cmd+1-9 tab-switching precedent: active
  // regardless of which element has focus, not scoped away from text
  // inputs, since Cmd+digit isn't a combo real typing produces.
  useEffect(() => {
    const VIEW_HOTKEYS: Record<string, View> = {
      '1': { kind: 'composition' },
      '2': { kind: 'configure' },
      '3': { kind: 'activity' },
      '4': { kind: 'runs' },
      '5': { kind: 'spec' },
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (!e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      const target = VIEW_HOTKEYS[e.key];
      if (!target) return;
      e.preventDefault();
      setView(target);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [setView]);

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
    CompositionService.Workflows().then((list) => setWorkflows(list ?? [])).catch(console.error);
  }, [setWorkflows]);

  useEffect(() => {
    CapabilitiesService.List().then((list) => setCapabilities(list ?? [])).catch(console.error);
  }, [setCapabilities]);

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

          {/* Settings pulled out of the NavList entirely, into a bottom-
              anchored footer slot -- Notion/Slack's own pattern for
              app-level config vs. content destinations (docs/SPEC.md
              §3.5). Not a capability (no build status/SPEC section of
              its own), so it isn't driven by CapabilitiesService.List()
              the way the rows above are -- a fixed control, same
              reasoning as the Spec entry already being fixed rather than
              data-driven. */}
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
          {view.kind === 'activity' && <ActivityView/>}

          {view.kind === 'composition' && <CompositionView/>}

          {view.kind === 'configure' && <ConfigureView/>}

          {view.kind === 'runs' && <RunsView/>}

          {view.kind === 'settings' && <SettingsView/>}

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
          <a className={styles.docs} data-wml-openURL="https://v3.wails.io" aria-label="Wails documentation">Docs
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="7" y1="17" x2="17" y2="7"/><polyline points="7 7 17 7 17 17"/></svg>
          </a>
        </span>
      </footer>
    </div>
  )
}

export default App
