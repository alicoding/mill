import { create } from 'zustand'
import { RemoteAuthService } from './bindings'
import type { DeviceInfo, HookToken } from './bindings'
import { background } from './background'
import { writeClipboardText } from './clipboardWrite'
import { messageFor, appTranslate } from './userError'

// Settings > Connections > Webhooks reads its whole state here rather
// than from the section's own local state, same reason
// browserBridgeStore.ts gives: the registered webhook.mint command
// needs the same truth the section renders, and a command has no React
// tree to reach into.
interface WebhookTokensState {
  hooks: DeviceInfo[] | null
  minting: boolean
  labelDraft: string
  fresh: HookToken | null
  copied: boolean
  error: string
  refresh: () => Promise<void>
  startMint: () => void
  cancelMint: () => void
  setLabelDraft: (label: string) => void
  confirmMint: () => Promise<void>
  copyFreshToken: () => Promise<void>
  revoke: (id: string) => Promise<void>
}

export const useWebhookTokensStore = create<WebhookTokensState>()((set, get) => ({
  hooks: null,
  minting: false,
  labelDraft: '',
  fresh: null,
  copied: false,
  error: '',
  refresh: async () => {
    try {
      const hooks = await RemoteAuthService.ListHooks()
      set({ hooks: hooks ?? [] })
    } catch (err) {
      set({ error: messageFor(err, appTranslate) })
    }
  },
  startMint: () => set({ minting: true, labelDraft: '' }),
  cancelMint: () => set({ minting: false, labelDraft: '' }),
  setLabelDraft: (label) => set({ labelDraft: label }),
  confirmMint: async () => {
    const label = get().labelDraft.trim()
    set({ minting: false })
    const token = await RemoteAuthService.MintHookToken(label)
    set({ fresh: token, copied: false })
    await get().refresh()
  },
  copyFreshToken: async () => {
    const fresh = get().fresh
    if (!fresh) return
    await writeClipboardText(fresh.token)
    set({ copied: true })
    setTimeout(() => set({ copied: false }), 1500)
  },
  revoke: async (id: string) => {
    await RemoteAuthService.RevokeDevice(id)
    // Revoking the token still on screen clears the once-shown panel
    // with it -- leaving a dead credential rendered would read as
    // still usable.
    const fresh = get().fresh
    if (fresh && fresh.deviceId === id) {
      set({ fresh: null })
    }
    await get().refresh()
  },
}))

// The one refetch path every surface calls, so the section's mount and
// a command's completion can never disagree.
export function refreshWebhookTokens(): Promise<void> {
  return background(useWebhookTokensStore.getState().refresh(), 'webhookTokens.refresh')
}
