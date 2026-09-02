import { ThemeProvider, BaseStyles } from '@primer/react'
import { RunMonitor } from './RunMonitor'
import { COLOR_MODE_STORAGE_KEY } from './theme'

// The run monitor's own window shell (goal 0294 S2): the '#/runmonitor'
// hash route in its own Wails window, same minimal shape as
// TrayPanelApp -- no app-shell chrome, the same persisted color mode.
export function RunMonitorApp() {
  const initialColorMode = (localStorage.getItem(COLOR_MODE_STORAGE_KEY) as 'light' | 'dark' | 'auto' | null) ?? 'auto'
  return (
    <ThemeProvider colorMode={initialColorMode}>
      <BaseStyles>
        <RunMonitor />
      </BaseStyles>
    </ThemeProvider>
  )
}
