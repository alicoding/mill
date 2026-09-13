import { create } from 'zustand'
import { PluginService } from '../../bindings/github.com/alicoding/mill/internal/services/pluginsvc'
import { notifyPluginRemoved } from './pluginRemoveSignal'
import { appTranslate, messageFor, userErrorFrom } from './userError'

interface ExtensionRecoveryState {
  unresolved: boolean
  retrying: boolean
  detail: string
  observe: (error: unknown) => void
  require: (detail?: string) => void
  retry: () => Promise<void>
}

export const useExtensionRecoveryStore = create<ExtensionRecoveryState>()((set) => ({
  unresolved: false,
  retrying: false,
  detail: '',
  observe: (error) => {
    const parsed = userErrorFrom(error)
    if (parsed.code === 'install-recovery-required') set({ unresolved: true, detail: messageFor(error, appTranslate) })
  },
  require: (detail = '') => set({ unresolved: true, detail }),
  retry: async () => {
    set({ retrying: true })
    try {
      await PluginService.RecoverInstallations()
      set({ unresolved: false, detail: '', retrying: false })
      notifyPluginRemoved()
    } catch (error) {
      set({ unresolved: true, detail: messageFor(error, appTranslate), retrying: false })
      throw error
    }
  },
}))
