import { TrayPanel } from './TrayPanel'
import { AppearanceProvider } from './AppearanceProvider'

// The dedicated shell for the menu-bar status panel's own Wails window
// (docs/goals/0189, loaded at the '#/traypanel' hash route --
// main.tsx). Same deliberately-minimal posture as QuickPanelApp: no
// app-shell chrome, and the SAME appearance every other window renders
// under, applied live rather than only at first paint (goal 0320).
export function TrayPanelApp() {
  return (
    <AppearanceProvider>
      <TrayPanel />
    </AppearanceProvider>
  )
}
