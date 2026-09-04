import { QuickPanel } from './QuickPanel'
import { AppearanceProvider } from './AppearanceProvider'

// docs/adr/0033-quick-panel-second-window.md: the dedicated shell for
// the Quick Panel's own Wails window (loaded at the '#/quickpanel' hash
// route, main.tsx). Deliberately minimal -- no PageLayout, sidebar,
// work-tab strip, or any of App.tsx's app-shell chrome; this window is
// one small floating surface, not a second copy of the main app.
// Appearance -- color mode, color scheme and density alike -- comes
// from AppearanceProvider, which every window shares and which applies
// a change made in Settings without a reload (goal 0320); this window
// no longer re-fetches density on focus to catch up.
export function QuickPanelApp() {
  return (
    <AppearanceProvider>
      <QuickPanel />
    </AppearanceProvider>
  )
}
