import { create } from 'zustand'
import { BridgeService, RemoteAuthService } from './bindings'
import type { BridgeStatusInfo, DeviceInfo, PairingCodeInfo } from './bindings'
import { background } from './background'
import { messageFor, appTranslate } from './userError'

// Settings > Connections > Browsers reads its whole state here rather
// than from the section's own local state, for the reason
// updateNoticeStore.ts was lifted: the two registered commands
// (browser.pair, browser.test) need the same truth the section renders,
// and a command has no React tree to reach into.
interface BrowserBridgeState {
  status: BridgeStatusInfo | null
  browsers: DeviceInfo[] | null
  pairing: PairingCodeInfo | null
  test: 'idle' | 'running' | 'passed' | 'failed'
  testSteps: number
  testDurationMS: number
  error: string
  refresh: () => Promise<void>
  pair: () => Promise<void>
  runTest: () => Promise<void>
  revoke: (id: string) => Promise<void>
}

export const useBrowserBridgeStore = create<BrowserBridgeState>()((set, get) => ({
  status: null,
  browsers: null,
  pairing: null,
  test: 'idle',
  testSteps: 0,
  testDurationMS: 0,
  error: '',
  refresh: async () => {
    const [status, browsers] = await Promise.all([BridgeService.BridgeStatus(), RemoteAuthService.ListBrowsers()])
    set({ status, browsers: browsers ?? [] })
  },
  pair: async () => {
    set({ error: '' })
    const pairing = await RemoteAuthService.GeneratePairingCode()
    set({ pairing })
  },
  runTest: async () => {
    set({ test: 'running', error: '' })
    try {
      const result = await BridgeService.TestConnection()
      set({ test: 'passed', testSteps: result.steps, testDurationMS: result.durationMs })
    } catch (err) {
      set({ test: 'failed', error: messageFor(err, appTranslate) })
      return
    }
    await get().refresh()
  },
  revoke: async (id: string) => {
    await RemoteAuthService.RevokeDevice(id)
    // A revoked browser loses its stream, so the connected count and
    // the list both change -- read both back rather than editing the
    // list in place and leaving the count stale.
    await get().refresh()
  },
}))

// The one refetch path every surface calls, so the section's mount and
// a command's completion can never disagree.
export function refreshBrowserBridge(): Promise<void> {
  return background(useBrowserBridgeStore.getState().refresh(), 'browserBridge.refresh')
}
