import i18n from 'i18next'
import { create } from 'zustand'
import { PluginService } from '../../bindings/github.com/alicoding/mill/internal/services/pluginsvc'
import type { InstallCandidate, InstallCommitResult, InstallPreview } from '../../bindings/github.com/alicoding/mill/internal/services/pluginsvc/models'
import type { CommandContext } from './commandContext'
import { extensionInstallAttemptContext, extensionInstallCandidateContext } from './commandContext'
import { useExtensionSourcesStore } from './extensionSourcesStore'
import { newLocalID } from './localId'
import { notifyPluginRemoved } from './pluginRemoveSignal'
import { pushNotice } from './noticeStore'
import { useUISignalStore } from './uiSignalStore'
import { appTranslate, messageFor, userErrorFrom } from './userError'
import { useExtensionUpdatesStore } from './extensionUpdatesStore'
import { useExtensionRecoveryStore } from './extensionRecoveryStore'

export type InstallPhase = 'idle' | 'reserved' | 'preparing' | 'ready' | 'committing' | 'error'
export type InstallMode = 'install' | 'update' | 'import'

interface ExtensionInstallState {
  operationId: string | null
  candidate: InstallCandidate | null
  handle: string
  expiresAt: string
  preview: InstallPreview | null
  phase: InstallPhase
  mode: InstallMode
  visible: boolean
  error: string
  errorCode: string
  retryable: boolean
  acknowledged: boolean
  prepare: (ctx: CommandContext) => Promise<void>
  confirm: (ctx: CommandContext) => Promise<void>
  dismiss: (ctx: CommandContext) => void
  retry: (ctx: CommandContext) => Promise<void>
  setAcknowledged: (acknowledged: boolean) => void
  markExpired: (operationId: string) => void
}

const retryableCodes = new Set([
  'install-preparation-expired', 'install-preparation-invalid', 'install-candidate-changed',
  'install-installed-changed', 'install-artifact-changed',
])

const emptyState = {
  operationId: null,
  candidate: null,
  handle: '',
  expiresAt: '',
  preview: null,
  phase: 'idle' as const,
  mode: 'install' as const,
  visible: false,
  error: '',
  errorCode: '',
  retryable: false,
  acknowledged: false,
}

function installMode(candidate: InstallCandidate): InstallMode {
  if (candidate.Kind === 'update') return 'update'
  if (candidate.Kind === 'theme') return 'import'
  return 'install'
}

function attemptMatches(ctx: CommandContext | undefined, state: ExtensionInstallState): boolean {
  return extensionInstallAttemptContext(ctx)?.operationId === state.operationId
}

function validInstallCandidate(candidate: InstallCandidate): boolean {
  const marketplace = candidate.Marketplace !== '' || candidate.Incarnation !== ''
  const identity = candidate.ID !== '' || candidate.Version !== ''
  const link = candidate.Locator !== ''
  const theme = candidate.Encoded !== '' || candidate.Basename !== '' || candidate.DisplayName !== '' || candidate.Family !== ''
  switch (candidate.Kind) {
    case 'marketplace':
      return candidate.Marketplace !== '' && candidate.Incarnation !== '' && candidate.ID !== '' && candidate.Version !== '' && !link && !theme
    case 'link':
      return link && !marketplace && !identity && !theme
    case 'update':
      return candidate.ID !== '' && candidate.Version !== '' && !marketplace && !link && !theme
    case 'theme':
      return candidate.Encoded !== '' && candidate.Basename !== '' && candidate.DisplayName !== '' && (candidate.Family === 'light' || candidate.Family === 'dark') && !marketplace && !identity && !link
    default:
      return false
  }
}

export function extensionInstallPrepareEnabled(ctx: CommandContext | undefined): boolean {
  const state = useExtensionMarketplaceInstallStore.getState()
  const target = extensionInstallCandidateContext(ctx)
  return state.phase === 'idle' && !useExtensionUpdatesStore.getState().bulkActive && !useExtensionRecoveryStore.getState().unresolved && target !== null && validInstallCandidate(target.candidate)
}

export function extensionInstallConfirmEnabled(ctx: CommandContext | undefined): boolean {
  const state = useExtensionMarketplaceInstallStore.getState()
  return attemptMatches(ctx, state) && state.phase === 'ready' && !useExtensionRecoveryStore.getState().unresolved && !!state.preview && !state.preview.PolicyRefusal &&
    (state.preview.Tier !== 'unverified' || state.acknowledged) && Date.parse(state.expiresAt) > Date.now()
}

export function extensionInstallDismissEnabled(ctx: CommandContext | undefined): boolean {
  const state = useExtensionMarketplaceInstallStore.getState()
  return attemptMatches(ctx, state) && state.phase !== 'idle' && state.visible
}

export function extensionInstallRetryEnabled(ctx: CommandContext | undefined): boolean {
  const state = useExtensionMarketplaceInstallStore.getState()
  return attemptMatches(ctx, state) && state.phase === 'error' && state.retryable && state.candidate !== null &&
    !useExtensionRecoveryStore.getState().unresolved && !useExtensionUpdatesStore.getState().bulkActive
}

export const useExtensionMarketplaceInstallStore = create<ExtensionInstallState>()((set, get) => ({
  ...emptyState,
  prepare: async (ctx) => {
    const target = extensionInstallCandidateContext(ctx)
    if (!target || !validInstallCandidate(target.candidate) || get().phase !== 'idle') return
    const operationId = newLocalID()
    const candidate = { ...target.candidate }
    set({ ...emptyState, operationId, candidate, phase: 'reserved', mode: installMode(candidate), visible: true })
    let handle = ''
    try {
      const reservation = await PluginService.ReserveInstallPreparation()
      handle = reservation.Handle
      if (get().operationId !== operationId) {
        await PluginService.CancelInstallPreparation(handle)
        return
      }
      set({ handle, expiresAt: reservation.ExpiresAt, phase: 'preparing' })
      const prepared = await PluginService.PrepareInstall(handle, candidate)
      if (get().operationId !== operationId) {
        await PluginService.CancelInstallPreparation(handle)
        return
      }
      set({
        handle: prepared.Handle, expiresAt: prepared.ExpiresAt, preview: prepared.Preview, phase: 'ready',
        error: '', errorCode: '', retryable: false,
      })
    } catch (error) {
      if (get().operationId !== operationId) {
        if (handle) void PluginService.CancelInstallPreparation(handle)
        return
      }
      const { code } = userErrorFrom(error)
      useExtensionRecoveryStore.getState().observe(error)
      set({ phase: 'error', error: messageFor(error, appTranslate), errorCode: code, retryable: retryableCodes.has(code) })
    }
  },
  confirm: async (ctx) => {
    const state = get()
    if (!attemptMatches(ctx, state) || !state.handle || state.phase !== 'ready') return
    const operationId = state.operationId!
    const mode = state.mode
    const name = state.preview?.Name || state.preview?.ID || ''
    set({ phase: 'committing' })
    try {
      const result = await PluginService.ConfirmInstall(state.handle)
      if (get().operationId !== operationId) return
      set(emptyState)
      await finishSuccessfulInstall(mode, name, result)
    } catch (error) {
      if (get().operationId !== operationId) return
      const { code } = userErrorFrom(error)
      const message = messageFor(error, appTranslate)
      useExtensionRecoveryStore.getState().observe(error)
      if (!get().visible) {
        set(emptyState)
        pushNotice({ level: 'error', text: message })
        return
      }
      set({ handle: '', phase: 'error', error: message, errorCode: code, retryable: retryableCodes.has(code) })
      pushNotice({ level: 'error', text: message })
    }
  },
  dismiss: (ctx) => {
    const state = get()
    if (!attemptMatches(ctx, state)) return
    if (state.phase === 'committing') {
      set({ visible: false })
      return
    }
    const handle = state.handle
    set(emptyState)
    if (handle) void PluginService.CancelInstallPreparation(handle)
  },
  retry: async (ctx) => {
    const state = get()
    if (!attemptMatches(ctx, state) || state.phase !== 'error' || !state.retryable || !state.candidate) return
    const candidate = state.candidate
    const oldHandle = state.handle
    set(emptyState)
    if (oldHandle) await PluginService.CancelInstallPreparation(oldHandle)
    await get().prepare({ kind: 'extensionInstallCandidate', candidate })
  },
  setAcknowledged: (acknowledged) => set({ acknowledged }),
  markExpired: (operationId) => {
    const state = get()
    if (state.operationId !== operationId || state.phase !== 'ready') return
    set({ phase: 'error', errorCode: 'install-preparation-expired', error: i18n.t('views:extensions.install.expired'), retryable: true })
  },
}))

async function finishSuccessfulInstall(mode: InstallMode, name: string, result: InstallCommitResult): Promise<void> {
  if (result.RecoveryRequired) useExtensionRecoveryStore.getState().require()
  notifyPluginRemoved()
  await useExtensionSourcesStore.getState().loadBrowse()
  useUISignalStore.getState().requestExtensionInstalled()
  const key = mode === 'update' ? 'views:extensions.updates.updated' : mode === 'import' && result.NeedsAllow
    ? 'views:extensions.themeImport.doneNeedsAllow'
    : mode === 'import' ? 'views:extensions.themeImport.done' : 'views:extensions.install.done'
  pushNotice({ level: 'success', text: i18n.t(key, { name, version: result.Record.version }) })
  if (result.RecoveryRequired) pushNotice({ level: 'error', text: i18n.t('views:extensions.recovery.message') })
  if (result.CatalogWarningCode) pushNotice({ level: 'error', text: i18n.t('views:extensions.install.catalogRefreshFailed') })
}
