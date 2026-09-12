import i18n from 'i18next'
import { create } from 'zustand'
import { PluginService } from '../../bindings/github.com/alicoding/mill/internal/services/pluginsvc'
import type { InstallCandidate, UpdateCandidate } from '../../bindings/github.com/alicoding/mill/internal/services/pluginsvc/models'
import { pushNotice } from './noticeStore'
import { notifyPluginRemoved } from './pluginRemoveSignal'
import { appTranslate, messageFor, userErrorFrom } from './userError'
import { useExtensionRecoveryStore } from './extensionRecoveryStore'

export type UpdateItemPhase = 'preparing' | 'updating' | 'updated' | 'needs-review' | 'failed' | 'cancelled' | 'recovery-blocked'

interface ExtensionUpdatesState {
  loaded: boolean
  checking: boolean
  checkedAt: string
  candidates: UpdateCandidate[]
  problems: string[]
  loadError: string
  bulkActive: boolean
  canCancelRemaining: boolean
  cancelRemaining: boolean
  currentHandle: string
  itemPhases: Record<string, UpdateItemPhase>
}

export const useExtensionUpdatesStore = create<ExtensionUpdatesState>()(() => ({
  loaded: false,
  checking: false,
  checkedAt: '',
  candidates: [],
  problems: [],
  loadError: '',
  bulkActive: false,
  canCancelRemaining: false,
  cancelRemaining: false,
  currentHandle: '',
  itemPhases: {},
}))

export async function refreshUpdates(): Promise<boolean> {
  try {
    const check = await PluginService.ListUpdates()
    useExtensionUpdatesStore.setState({
      loaded: true,
      checkedAt: check.checkedAt ?? '',
      candidates: check.candidates ?? [],
      problems: check.problems ?? [],
      loadError: '',
    })
    return true
  } catch (error) {
    useExtensionUpdatesStore.setState({ loadError: messageFor(error, appTranslate) })
    return false
  }
}

export function clearRecoveryBlockedUpdates(): void {
  useExtensionUpdatesStore.setState((state) => ({
    itemPhases: Object.fromEntries(Object.entries(state.itemPhases).filter(([, phase]) => phase !== 'recovery-blocked')),
  }))
}

export function updateCandidateFor(id: string): UpdateCandidate | undefined {
  return useExtensionUpdatesStore.getState().candidates.find((candidate) => candidate.ID === id)
}

export function checkForUpdatesWithNotice(): void {
  const state = useExtensionUpdatesStore.getState()
  if (state.checking || state.bulkActive) return
  useExtensionUpdatesStore.setState({ checking: true })
  PluginService.CheckForUpdates()
    .then((check) => {
      const candidates = check.candidates ?? []
      useExtensionUpdatesStore.setState({
        loaded: true, checkedAt: check.checkedAt ?? '', candidates, problems: check.problems ?? [], loadError: '',
      })
      pushNotice({
        level: 'success',
        text: candidates.length === 0
          ? i18n.t('views:extensions.updates.checkDoneNone')
          : i18n.t('views:extensions.updates.checkDone', { count: candidates.length }),
      })
    })
    .catch((error) => pushNotice({ level: 'error', text: i18n.t('views:extensions.updates.checkFailed', { error: messageFor(error, appTranslate) }) }))
    .finally(() => useExtensionUpdatesStore.setState({ checking: false }))
}

export function updateAllWithNotice(): void {
  const state = useExtensionUpdatesStore.getState()
  if (state.bulkActive || state.candidates.length === 0) return
  const candidates = state.candidates.map((candidate) => ({ ...candidate }))
  useExtensionUpdatesStore.setState({ bulkActive: true, canCancelRemaining: true, cancelRemaining: false, currentHandle: '', itemPhases: {} })
  void runBulkUpdates(candidates)
}

export function cancelRemainingUpdates(): void {
  const state = useExtensionUpdatesStore.getState()
  if (!state.bulkActive || !state.canCancelRemaining) return
  useExtensionUpdatesStore.setState({ cancelRemaining: true })
  if (state.currentHandle) void PluginService.CancelInstallPreparation(state.currentHandle)
}

async function runBulkUpdates(candidates: UpdateCandidate[]): Promise<void> {
	const counts: BulkCounts = { updated: 0, review: 0, failed: 0, cancelled: 0, recoveryBlocked: 0 }
	let recoveryRequired = false
	for (let index = 0; index < candidates.length; index++) {
		const stopped = markUnstarted(candidates, index, recoveryRequired)
		if (stopped) {
			counts[stopped] += candidates.length - index
			break
		}
		const result = await updateOne(candidates[index]!, index + 1 < candidates.length)
		counts[result.count]++
		recoveryRequired = result.recoveryRequired
	}
	if (counts.updated > 0) notifyPluginRemoved()
	if (!recoveryRequired) await refreshUpdates()
	useExtensionUpdatesStore.setState({ bulkActive: false, canCancelRemaining: false, cancelRemaining: false, currentHandle: '' })
	showBulkSummary(counts, recoveryRequired)
}

type BulkCount = 'updated' | 'review' | 'failed' | 'cancelled'
type BulkStop = 'recoveryBlocked' | 'cancelled'
type BulkCounts = Record<BulkCount | 'recoveryBlocked', number>

function markUnstarted(candidates: UpdateCandidate[], index: number, recoveryRequired: boolean): BulkStop | null {
	const stopped = recoveryRequired ? 'recoveryBlocked' : useExtensionUpdatesStore.getState().cancelRemaining ? 'cancelled' : null
	if (!stopped) return null
	const phase = stopped === 'recoveryBlocked' ? 'recovery-blocked' : 'cancelled'
	for (const remaining of candidates.slice(index)) setItemPhase(remaining.ID, phase)
	return stopped
}

async function updateOne(candidate: UpdateCandidate, hasRemaining: boolean): Promise<{ count: BulkCount; recoveryRequired: boolean }> {
	try {
		useExtensionUpdatesStore.setState({ canCancelRemaining: true })
		setItemPhase(candidate.ID, 'preparing')
		const reservation = await PluginService.ReserveInstallPreparation()
		const handle = reservation.Handle
		useExtensionUpdatesStore.setState({ currentHandle: handle })
		if (useExtensionUpdatesStore.getState().cancelRemaining) {
			await PluginService.CancelInstallPreparation(handle)
			setItemPhase(candidate.ID, 'cancelled')
			return { count: 'cancelled', recoveryRequired: false }
		}
		const prepared = await PluginService.PrepareInstall(handle, installCandidate(candidate))
		if (prepared.RequiresReview) {
			await PluginService.CancelInstallPreparation(handle)
			setItemPhase(candidate.ID, 'needs-review')
			return { count: 'review', recoveryRequired: false }
		}
		useExtensionUpdatesStore.setState({ currentHandle: '', canCancelRemaining: hasRemaining })
		setItemPhase(candidate.ID, 'updating')
		const result = await PluginService.ConfirmInstall(handle)
		setItemPhase(candidate.ID, 'updated')
		if (result.RecoveryRequired) useExtensionRecoveryStore.getState().require()
		if (result.CatalogWarningCode) pushNotice({ level: 'error', text: i18n.t('views:extensions.install.catalogRefreshFailed') })
		return { count: 'updated', recoveryRequired: result.RecoveryRequired }
	} catch (error) {
		return failedUpdateResult(candidate, error)
	} finally {
		useExtensionUpdatesStore.setState({ currentHandle: '' })
	}
}

function failedUpdateResult(candidate: UpdateCandidate, error: unknown): { count: BulkCount; recoveryRequired: boolean } {
	const { code } = userErrorFrom(error)
	useExtensionRecoveryStore.getState().observe(error)
	if (code === 'install-preparation-cancelled' && useExtensionUpdatesStore.getState().cancelRemaining) {
		setItemPhase(candidate.ID, 'cancelled')
		return { count: 'cancelled', recoveryRequired: false }
	}
	setItemPhase(candidate.ID, 'failed')
	pushNotice({ level: 'error', text: i18n.t('views:extensions.updates.updateFailed', { name: candidate.Name || candidate.ID, error: messageFor(error, appTranslate) }) })
	return { count: 'failed', recoveryRequired: code === 'install-recovery-required' }
}

function showBulkSummary(counts: BulkCounts, recoveryRequired: boolean): void {
	const parts = [
		counts.updated ? i18n.t('views:extensions.updates.bulkUpdated', { count: counts.updated }) : '',
		counts.review ? i18n.t('views:extensions.updates.bulkNeedsReview', { count: counts.review }) : '',
		counts.failed ? i18n.t('views:extensions.updates.bulkFailed', { count: counts.failed }) : '',
		counts.cancelled ? i18n.t('views:extensions.updates.bulkCancelled', { count: counts.cancelled }) : '',
		counts.recoveryBlocked ? i18n.t('views:extensions.updates.bulkRecoveryBlocked', { count: counts.recoveryBlocked }) : '',
	].filter(Boolean)
	if (parts.length) pushNotice({ level: counts.failed || recoveryRequired ? 'error' : counts.review || counts.cancelled ? 'info' : 'success', text: parts.join(' ') })
}

function installCandidate(candidate: UpdateCandidate): InstallCandidate {
  return {
    Kind: 'update', Marketplace: '', Incarnation: '', ID: candidate.ID, Version: candidate.Available,
    Locator: '', Encoded: '', Basename: '', DisplayName: '', Family: '',
  }
}

function setItemPhase(id: string, phase: UpdateItemPhase): void {
  useExtensionUpdatesStore.setState((state) => ({ itemPhases: { ...state.itemPhases, [id]: phase } }))
}
