import { Capture } from './Capture'
import { AppearanceProvider } from './AppearanceProvider'

// The capture window's own shell (goal 0309): the '#/capture' hash
// route in its own Wails window, the same minimal shape as
// RunMonitorApp -- no app-shell chrome, the shared appearance shell.
export function CaptureApp() {
  return (
    <AppearanceProvider>
      <Capture />
    </AppearanceProvider>
  )
}
