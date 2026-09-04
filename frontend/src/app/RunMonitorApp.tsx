import { RunMonitor } from './RunMonitor'
import { AppearanceProvider } from './AppearanceProvider'

// The run monitor's own window shell (goal 0294 S2): the '#/runmonitor'
// hash route in its own Wails window, same minimal shape as
// TrayPanelApp -- no app-shell chrome, the shared appearance shell.
export function RunMonitorApp() {
  return (
    <AppearanceProvider>
      <RunMonitor />
    </AppearanceProvider>
  )
}
