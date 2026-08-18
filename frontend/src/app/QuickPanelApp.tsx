import { useEffect } from 'react'
import { ThemeProvider, BaseStyles } from '@primer/react'
import { QuickPanel } from './QuickPanel'
import { COLOR_MODE_STORAGE_KEY } from './theme'
import { SettingsService } from '../shared/bindings'
import { applyDensity } from '../shared/density'

// docs/adr/0033-quick-panel-second-window.md: the dedicated shell for
// the Quick Panel's own Wails window (loaded at the '#/quickpanel' hash
// route, main.tsx). Deliberately minimal -- no PageLayout, sidebar,
// work-tab strip, or any of App.tsx's app-shell chrome; this window is
// one small floating surface, not a second copy of the main app.
// Reads the same persisted color-mode preference App.tsx's theme
// switcher writes (frontend/src/app/theme.ts) so the panel matches
// whatever the user last chose there, rather than always defaulting to
// 'auto' independently of it.
export function QuickPanelApp() {
  const initialColorMode = (localStorage.getItem(COLOR_MODE_STORAGE_KEY) as 'light' | 'dark' | 'auto' | null) ?? 'auto'

  // Display density (docs/goals/0096): a second, independent instance
  // of App.tsx's own mount-time fetch+apply -- this window is a
  // separate Wails webview/JS context (goal 0017's per-window fetch
  // pattern, QuickPanel.tsx's own comment), so App.tsx's effect never
  // reaches it. Re-applied on every window focus (not just mount) since
  // QuickPanel.tsx itself is at architecture.md's 500-line cap and
  // can't grow its own focus-triggered refresh list to include this.
  useEffect(() => {
    const fetchAndApply = () => {
      SettingsService.GetDisplayDensity().then((d) => applyDensity(d === 'compact' ? 'compact' : 'comfortable')).catch(console.error)
    }
    fetchAndApply()
    window.addEventListener('focus', fetchAndApply)
    return () => window.removeEventListener('focus', fetchAndApply)
  }, [])

  return (
    <ThemeProvider colorMode={initialColorMode}>
      <BaseStyles>
        <QuickPanel />
      </BaseStyles>
    </ThemeProvider>
  )
}
