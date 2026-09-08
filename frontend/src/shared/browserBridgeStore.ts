import { create } from 'zustand'
import { BridgeService, RemoteAuthService } from './bindings'
import type { BridgeStatusInfo, DeviceInfo, PairingCodeInfo, PendingPairingRequest } from './bindings'
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
  // The Bluetooth-style incoming request a browser's popup minted
  // (goal 0379) -- null when nothing is pending. Mill has no server
  // push for "a browser just asked to pair", so this is read back on
  // the same poll the outgoing code card already runs.
  incomingRequest: PendingPairingRequest | null
  // How many browsers were paired the moment this code was minted --
  // the code card clears itself once `browsers` grows past this count,
  // the only pairing-succeeded signal available without a server push
  // (goal 0369, shared/pairingCountdown.ts's gainedMember).
  pairingBaselineCount: number
  test: 'idle' | 'running' | 'passed' | 'failed'
  testSteps: number
  testDurationMS: number
  // Where the extension's files were written, once someone has asked
  // for them. A browser's "Load unpacked" dialog needs the path typed
  // or pasted, so it is shown as well as opened.
  extensionPath: string
  error: string
  refresh: () => Promise<void>
  pair: () => Promise<void>
  clearPairing: () => void
  runTest: () => Promise<void>
  revealExtension: () => Promise<void>
  revoke: (id: string) => Promise<void>
  acceptPairRequest: () => Promise<void>
  denyPairRequest: () => Promise<void>
}

export const useBrowserBridgeStore = create<BrowserBridgeState>()((set, get) => ({
  status: null,
  browsers: null,
  pairing: null,
  incomingRequest: null,
  pairingBaselineCount: 0,
  test: 'idle',
  testSteps: 0,
  testDurationMS: 0,
  extensionPath: '',
  error: '',
  refresh: async () => {
    const [status, browsers, incoming] = await Promise.all([
      BridgeService.BridgeStatus(),
      RemoteAuthService.ListBrowsers(),
      RemoteAuthService.PendingPairingRequest(),
    ])
    set({ status, browsers: browsers ?? [], incomingRequest: incoming?.requestId ? incoming : null })
  },
  pair: async () => {
    set({ error: '' })
    const pairing = await RemoteAuthService.GeneratePairingCode()
    set({ pairing, pairingBaselineCount: (get().browsers ?? []).length })
  },
  clearPairing: () => set({ pairing: null }),
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
  revealExtension: async () => {
    set({ error: '' })
    try {
      set({ extensionPath: await BridgeService.RevealExtensionFolder() })
    } catch (err) {
      set({ error: messageFor(err, appTranslate) })
    }
  },
  revoke: async (id: string) => {
    await RemoteAuthService.RevokeDevice(id)
    // A revoked browser loses its stream, so the connected count and
    // the list both change -- read both back rather than editing the
    // list in place and leaving the count stale.
    await get().refresh()
  },
  acceptPairRequest: async () => {
    const request = get().incomingRequest
    if (!request) return
    await RemoteAuthService.AcceptPairingRequest(request.requestId)
    set({ incomingRequest: null })
    await get().refresh()
  },
  denyPairRequest: async () => {
    const request = get().incomingRequest
    if (!request) return
    await RemoteAuthService.DenyPairingRequest(request.requestId)
    set({ incomingRequest: null })
  },
}))

// The one refetch path every surface calls, so the section's mount and
// a command's completion can never disagree.
export function refreshBrowserBridge(): Promise<void> {
  return background(useBrowserBridgeStore.getState().refresh(), 'browserBridge.refresh')
}
