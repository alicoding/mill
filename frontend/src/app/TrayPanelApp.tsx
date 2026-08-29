import { ThemeProvider, BaseStyles } from '@primer/react'
import { TrayPanel } from './TrayPanel'
import { COLOR_MODE_STORAGE_KEY } from './theme'

// The dedicated shell for the menu-bar status panel's own Wails window
// (docs/goals/0189, loaded at the '#/traypanel' hash route --
// main.tsx). Same deliberately-minimal posture as QuickPanelApp: no
// app-shell chrome, and the SAME persisted color-mode preference the
// main window's theme switcher writes, so the panel matches it.
export function TrayPanelApp() {
  const initialColorMode = (localStorage.getItem(COLOR_MODE_STORAGE_KEY) as 'light' | 'dark' | 'auto' | null) ?? 'auto'
  return (
    <ThemeProvider colorMode={initialColorMode}>
      <BaseStyles>
        <TrayPanel />
      </BaseStyles>
    </ThemeProvider>
  )
}
