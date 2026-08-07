import { useState, useEffect } from 'react'
import {Events, WML} from "@wailsio/runtime";
import {Label, NavList, PageLayout} from "@primer/react";
import SpecView from "./SpecView";
import RunbookView from "./RunbookView";
import ActivityView from "./ActivityView";
import CompositionView from "./CompositionView";
import PlaceholderView from "./PlaceholderView";
import { RunbookService, CapabilitiesService } from "../bindings/github.com/alicoding/mill";
import { useAppStore, viewFor, viewsEqual, statusVariant } from "./store";
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
        <PageLayout.Sidebar width="small" responsiveVariant="default" divider="line" padding="condensed">
          <NavList>
            {capabilities.map((c) => {
              const target = viewFor(c);
              return (
                <NavList.Item
                  key={c.ID}
                  href="#"
                  aria-current={viewsEqual(view, target) ? 'page' : undefined}
                  onClick={(e) => { e.preventDefault(); setView(target) }}
                >
                  {c.NavLabel || c.Label}
                  <NavList.TrailingVisual>
                    <Label variant={statusVariant(c.Status)} size="small">{c.Status}</Label>
                  </NavList.TrailingVisual>
                </NavList.Item>
              );
            })}
            <NavList.Divider/>
            <NavList.Item
              href="#"
              aria-current={view.kind === 'spec' ? 'page' : undefined}
              onClick={(e) => { e.preventDefault(); setView({ kind: 'spec' }) }}
            >
              Spec
            </NavList.Item>
          </NavList>
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
        <span className={styles.version}><span>{wailsVersion}</span></span>
        <span className={styles.time}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          <span>{time}</span>
        </span>
        <a className={styles.docs} data-wml-openURL="https://v3.wails.io" aria-label="Wails documentation">Docs
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="7" y1="17" x2="17" y2="7"/><polyline points="7 7 17 7 17 17"/></svg>
        </a>
      </footer>
    </div>
  )
}

export default App
