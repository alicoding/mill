import { useState, useEffect } from 'react'
import {Events, WML} from "@wailsio/runtime";
import {Label, UnderlineNav} from "@primer/react";
import SpecView from "./SpecView";
import RunbookView from "./RunbookView";
import ActivityView, { type ActivityEntry } from "./ActivityView";
import { RunbookService } from "../bindings/github.com/alicoding/mill";
import type { Action } from "../bindings/github.com/alicoding/mill/internal/domain/runbook/models";

// Show the actual Wails version this project was generated against.
const wailsVersion = "v3.0.0-beta.4";

const MAX_ACTIVITY_ENTRIES = 50;

// import.meta.env.DEV is Vite's own built-in flag, not something Mill
// wires up itself: true only for a real `vite serve` process (what
// `task dev`'s window actually renders through, per devServerURL in its
// logs), false for every `vite build` output regardless of --mode --
// verified directly, not assumed, since that distinction is easy to get
// backwards. This is Mill's answer to "am I looking at a dev build,
// and is it current" (see docs/SPEC.md's dev-build/hot-reload notes).
const isDevBuild = import.meta.env.DEV;

function App() {
  const [view, setView] = useState<'spec' | 'runbook' | 'activity'>('runbook');
  const [time, setTime] = useState<string>('Listening for Time event...');
  const [actions, setActions] = useState<Action[] | null>(null);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  // Captured once per mount. A Go-file change forces a full app reload
  // (Go isn't hot-reloadable, unlike frontend-only edits which apply via
  // Vite HMR without remounting) -- so this timestamp doubles as "when
  // did the last Go rebuild actually land," not just page-load trivia.
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
  }, []);

  // Subscribed here, not inside ActivityView/RunbookView, so a hotkey
  // fired while on a different tab is still captured -- the whole point
  // of this feed is answering "did anything fire at all" regardless of
  // which page happened to be open at the time.
  useEffect(() => {
    return Events.On('hotkey-activity', (evt) => {
      const entry = { ...evt.data, id: crypto.randomUUID(), time: new Date().toLocaleTimeString() };
      setActivity((prev) => [entry, ...prev].slice(0, MAX_ACTIVITY_ENTRIES));
    });
  }, []);

  return (
    <>
      {isDevBuild && (
        <Label variant="severe" size="small" className="dev-ribbon">
          DEV · loaded {loadedAt}
        </Label>
      )}

      <UnderlineNav aria-label="Mill">
        <UnderlineNav.Item aria-current={view === 'runbook' ? 'page' : undefined} onSelect={(e) => { e.preventDefault(); setView('runbook') }}>
          Runbook
        </UnderlineNav.Item>
        <UnderlineNav.Item aria-current={view === 'activity' ? 'page' : undefined} onSelect={(e) => { e.preventDefault(); setView('activity') }}>
          Activity
        </UnderlineNav.Item>
        <UnderlineNav.Item aria-current={view === 'spec' ? 'page' : undefined} onSelect={(e) => { e.preventDefault(); setView('spec') }}>
          Spec
        </UnderlineNav.Item>
      </UnderlineNav>

      {view === 'runbook' && <RunbookView actions={actions}/>}

      {view === 'activity' && <ActivityView activity={activity} actions={actions}/>}

      {view === 'spec' && <SpecView/>}

      <hr className="footer-divider"/>
      <footer className="footer">
        <span className="footer-version"><span>{wailsVersion}</span></span>
        <span className="footer-time">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          <span>{time}</span>
        </span>
        <a className="footer-docs" data-wml-openURL="https://v3.wails.io" aria-label="Wails documentation">Docs
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="7" y1="17" x2="17" y2="7"/><polyline points="7 7 17 7 17 17"/></svg>
        </a>
      </footer>
    </>
  )
}

export default App
