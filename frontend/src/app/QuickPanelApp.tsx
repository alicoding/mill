import { ThemeProvider, BaseStyles } from '@primer/react'
import { QuickPanel } from './QuickPanel'
import { COLOR_MODE_STORAGE_KEY } from './theme'

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
  return (
    <ThemeProvider colorMode={initialColorMode}>
      <BaseStyles>
        <QuickPanel />
      </BaseStyles>
    </ThemeProvider>
  )
}
