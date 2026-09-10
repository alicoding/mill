import i18n from 'i18next'
import { create } from 'zustand'
import { PluginService } from '../../bindings/github.com/alicoding/mill/internal/services/pluginsvc'
import type { BrowseEntry, InstallPreview } from '../../bindings/github.com/alicoding/mill/internal/services/pluginsvc/models'
import type { CommandContext } from './commandContext'
import { marketplaceEntryContext } from './commandContext'
import { useExtensionSourcesStore } from './extensionSourcesStore'
import { usePluginPolicyStore } from './pluginPolicyStore'
import { notifyPluginRemoved } from './pluginRemoveSignal'
import { pushNotice } from './noticeStore'
import { useUISignalStore } from './uiSignalStore'
import { appTranslate, messageFor, userErrorFrom } from './userError'

type InstallPhase = 'idle' | 'previewing' | 'installing'

interface InstallTarget {
  marketplace: string
  pluginId: string
  name: string
  sourceIncarnation: string
  ownerToken: number
}

interface MarketplaceInstallState {
  target: InstallTarget | null
  preview: InstallPreview | null
  phase: InstallPhase
  refusal: string
  acknowledged: boolean
  requestRevision: number
  ownerToken: number | null
  nextOwnerToken: number
  previewInstall: (ctx: CommandContext) => Promise<void>
  confirmInstall: (ctx: CommandContext) => Promise<void>
  cancelInstall: () => void
  setAcknowledged: (acknowledged: boolean) => void
  mountOwner: () => number
  retireOwner: (ownerToken: number) => void
}

function currentEntry(ctx: CommandContext | undefined): { entry: BrowseEntry; sourceIncarnation: string } | null {
  const target = marketplaceEntryContext(ctx)
  const sources = useExtensionSourcesStore.getState()
  const entry = sources.browse?.Entries?.find((candidate) =>
    candidate.Marketplace === target?.marketplace && candidate.ID === target.pluginId)
  if (!target || !entry) return null
  const source = sources.browse?.Sources?.find((candidate) => candidate.name === target.marketplace)
  if (!source?.incarnation) return null
  return { entry, sourceIncarnation: source.incarnation }
}

function entryIsActionable(ctx: CommandContext | undefined): ReturnType<typeof currentEntry> {
  const sources = useExtensionSourcesStore.getState()
  const policy = usePluginPolicyStore.getState().policy
  const current = currentEntry(ctx)
  if (sources.browseLoading || sources.browseError || !sources.browse?.InstalledStateReady) return null
  if (!policy || policy.Error || !current || current.entry.Installed || current.entry.PolicyReason) return null
  return current
}

export function marketplacePreviewEnabled(ctx: CommandContext | undefined): boolean {
  const state = useExtensionMarketplaceInstallStore.getState()
  return state.phase === 'idle' && state.target === null && entryIsActionable(ctx) !== null
}

export function marketplaceConfirmEnabled(ctx: CommandContext | undefined): boolean {
  const state = useExtensionMarketplaceInstallStore.getState()
  const target = marketplaceEntryContext(ctx)
  const current = entryIsActionable(ctx)
  return state.phase === 'idle' && !!state.target && !!state.preview && !state.refusal && !state.preview.PolicyRefusal &&
    (state.preview.Tier !== 'unverified' || state.acknowledged) &&
    target?.marketplace === state.target.marketplace && target.pluginId === state.target.pluginId &&
    current?.sourceIncarnation === state.target.sourceIncarnation
}

export function marketplaceCancelEnabled(): boolean {
  const state = useExtensionMarketplaceInstallStore.getState()
  return state.phase !== 'installing' && (state.target !== null || state.preview !== null)
}

const cleared = {
  target: null,
  preview: null,
  phase: 'idle' as const,
  refusal: '',
  acknowledged: false,
}

export const useExtensionMarketplaceInstallStore = create<MarketplaceInstallState>()((set, get) => ({
  ...cleared,
  requestRevision: 0,
  ownerToken: null,
  nextOwnerToken: 0,
  previewInstall: async (ctx) => {
    const current = currentEntry(ctx)
    const target = marketplaceEntryContext(ctx)
    if (!current || !target) return
    const request = get().requestRevision + 1
    set({
      target: {
        marketplace: target.marketplace,
        pluginId: target.pluginId,
        name: current.entry.Name || current.entry.ID,
        sourceIncarnation: current.sourceIncarnation,
        ownerToken: get().ownerToken ?? 0,
      },
      preview: null,
      phase: 'previewing',
      refusal: '',
      acknowledged: false,
      requestRevision: request,
    })
    try {
      const preview = await PluginService.PreviewInstall(target.marketplace, target.pluginId)
      if (get().requestRevision !== request) return
      set({ preview, phase: 'idle' })
    } catch (error) {
      if (get().requestRevision === request) set(cleared)
      throw error
    }
  },
  confirmInstall: async (ctx) => {
    const target = marketplaceEntryContext(ctx)
    const pending = get().target
    if (!target || !pending) return
    set({ phase: 'installing' })
    try {
      await PluginService.InstallFromMarketplace(target.marketplace, target.pluginId)
      set(cleared)
      await useExtensionSourcesStore.getState().loadBrowse()
      notifyPluginRemoved()
      if (get().ownerToken === pending.ownerToken) useUISignalStore.getState().requestExtensionInstalled()
      pushNotice({ level: 'success', text: i18n.t('views:extensions.install.done', { name: pending.name }) })
    } catch (error) {
      const { code } = userErrorFrom(error)
      if (code === 'plugin-policy-refused' || code === 'plugin-install-refused') {
        set({ phase: 'idle', refusal: messageFor(error, appTranslate) })
        return
      }
      set({ phase: 'idle' })
      throw error
    }
  },
  cancelInstall: () => set((state) => ({ ...cleared, requestRevision: state.requestRevision + 1 })),
  setAcknowledged: (acknowledged) => set({ acknowledged }),
  mountOwner: () => {
    const ownerToken = get().nextOwnerToken + 1
    set({ ownerToken, nextOwnerToken: ownerToken })
    return ownerToken
  },
  retireOwner: (ownerToken) => set((state) => {
    if (state.ownerToken !== ownerToken) return state
    return state.phase === 'installing'
      ? { ownerToken: null }
      : { ...cleared, ownerToken: null, requestRevision: state.requestRevision + 1 }
  }),
}))
