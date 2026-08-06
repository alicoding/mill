import { useState, useEffect } from 'react'
import {Events, WML} from "@wailsio/runtime";
import {UnderlineNav} from "@primer/react";
import SpecView from "./SpecView";
import RunbookView from "./RunbookView";

// Show the actual Wails version this project was generated against.
const wailsVersion = "v3.0.0-beta.4";

function App() {
  const [view, setView] = useState<'spec' | 'runbook'>('runbook');
  const [time, setTime] = useState<string>('Listening for Time event...');

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

  return (
    <>
      <UnderlineNav aria-label="Mill">
        <UnderlineNav.Item aria-current={view === 'runbook' ? 'page' : undefined} onSelect={(e) => { e.preventDefault(); setView('runbook') }}>
          Runbook
        </UnderlineNav.Item>
        <UnderlineNav.Item aria-current={view === 'spec' ? 'page' : undefined} onSelect={(e) => { e.preventDefault(); setView('spec') }}>
          Spec
        </UnderlineNav.Item>
      </UnderlineNav>

      {view === 'runbook' && <RunbookView/>}

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
