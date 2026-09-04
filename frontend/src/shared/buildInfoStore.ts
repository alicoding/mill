import { create } from 'zustand'
import { SettingsService } from './bindings'
import type { BuildInfo } from './bindings'
import { background } from './background'

// Whether this instance is the native desktop webview, not server mode
// (the same GetBuildInfo() fact app/App.tsx's own isNativeWebview
// already derives, lifted into a store here so a command's synchronous
// enabled() predicate -- shared/commands.ts can never await one -- can
// read it too: panel.open/runMonitor.open (goal 0335) only make sense
// against a real native window). Defaults to false (hidden) until the
// first fetch resolves, the same "unknown renders the server/browser
// shape" rule App.tsx's own comment states -- wrongly offering a
// desktop-only action in a browser tab is worse than a beat of delay
// before it appears.
interface BuildInfoState {
  isDesktop: boolean
  setBuildInfo: (info: BuildInfo) => void
}

export const useBuildInfoStore = create<BuildInfoState>()((set) => ({
  isDesktop: false,
  setBuildInfo: (info) => set({ isDesktop: !info.Server }),
}))

export function refreshBuildInfo(): Promise<void> {
  return background(SettingsService.GetBuildInfo()
    .then((info) => useBuildInfoStore.getState().setBuildInfo(info)), 'buildInfo.getBuildInfo')
}

// Self-initializing: every auxiliary window that reads panel.open/
// runMonitor.open's enabled() (the main window's own palette and menu
// bar, at minimum) shares this module, and nothing else already fetches
// BuildInfo early enough for a synchronous predicate to read it -- see
// this store's own header comment. Guarded on `window` existing: this
// module is also reachable from Vitest's plain-Node module graph
// (shared/commands.ts pulls it in transitively), where the Wails
// runtime's own call plumbing has nothing to talk to.
if (typeof window !== 'undefined') void refreshBuildInfo()
