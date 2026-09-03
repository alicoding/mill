import { ThemeProvider, BaseStyles } from '@primer/react'
import { Capture } from './Capture'
import { COLOR_MODE_STORAGE_KEY } from './theme'

// The capture window's own shell (goal 0309): the '#/capture' hash
// route in its own Wails window, the same minimal shape as
// RunMonitorApp -- no app-shell chrome, the same persisted color mode.
export function CaptureApp() {
  const initialColorMode = (localStorage.getItem(COLOR_MODE_STORAGE_KEY) as 'light' | 'dark' | 'auto' | null) ?? 'auto'
  return (
    <ThemeProvider colorMode={initialColorMode}>
      <BaseStyles>
        <Capture />
      </BaseStyles>
    </ThemeProvider>
  )
}
