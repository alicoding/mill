import { create } from 'zustand'
import i18n from 'i18next'
import { PluginService } from '../../bindings/github.com/alicoding/mill/internal/services/pluginsvc'
import type { UpdateCandidate } from '../../bindings/github.com/alicoding/mill/internal/services/pluginsvc/models'
import { pushNotice } from './noticeStore'
import { notifyPluginRemoved } from './pluginRemoveSignal'
import { appTranslate, messageFor } from './userError'

// The last Check for updates outcome (docs/goals/0349 S5), read once
// from the service's own record and re-read after every check or
// update. Mill never checks on its own: `checkForUpdatesWithNotice`
// runs because someone pressed the button or the palette entry, and
// nothing here schedules it. The Updates tab, its count badge and the
// row menu's Update item all read this one store, so a candidate the
// tab lists is exactly the one the menu offers.
interface ExtensionUpdatesState {
  loaded: boolean
  checking: boolean
  checkedAt: string
  candidates: UpdateCandidate[]
  problems: string[]
}

export const useExtensionUpdatesStore = create<ExtensionUpdatesState>()(() => ({
  loaded: false,
  checking: false,
  checkedAt: '',
  candidates: [],
  problems: [],
}))

export async function refreshUpdates(): Promise<void> {
  try {
    const check = await PluginService.ListUpdates()
    useExtensionUpdatesStore.setState({
      loaded: true,
      checkedAt: check.checkedAt ?? '',
      candidates: check.candidates ?? [],
      problems: check.problems ?? [],
    })
  } catch {
    useExtensionUpdatesStore.setState({ loaded: true })
  }
}

export function updateCandidateFor(id: string): UpdateCandidate | undefined {
  return useExtensionUpdatesStore.getState().candidates.find((c) => c.ID === id)
}

// checkForUpdatesWithNotice is the ONE user action that fetches: every
// source is re-read and every installed extension's own source asked.
export function checkForUpdatesWithNotice(): void {
  if (useExtensionUpdatesStore.getState().checking) return
  useExtensionUpdatesStore.setState({ checking: true })
  PluginService.CheckForUpdates()
    .then((check) => {
      const candidates = check.candidates ?? []
      useExtensionUpdatesStore.setState({
        loaded: true,
        checkedAt: check.checkedAt ?? '',
        candidates,
        problems: check.problems ?? [],
      })
      pushNotice({
        level: 'success',
        text: candidates.length === 0
          ? i18n.t('views:extensions.updates.checkDoneNone')
          : i18n.t('views:extensions.updates.checkDone', { count: candidates.length }),
      })
    })
    .catch((err) => pushNotice({ level: 'error', text: i18n.t('views:extensions.updates.checkFailed', { error: messageFor(err, appTranslate) }) }))
    .finally(() => useExtensionUpdatesStore.setState({ checking: false }))
}

// applyUpdate runs one recorded candidate through the install door
// and raises the same re-scan signal an install does.
export async function applyUpdate(id: string, name: string): Promise<void> {
  const rec = await PluginService.UpdatePlugin(id)
  pushNotice({ level: 'success', text: i18n.t('views:extensions.updates.updated', { name, version: rec.version }) })
  notifyPluginRemoved()
  await refreshUpdates()
}

// updateAllWithNotice applies every candidate that needs no
// acknowledgment, one after another. An unverified candidate is left
// listed: its Update button opens the same acknowledgment the first
// install asked for, and nothing here can answer it on the user's
// behalf.
export function updateAllWithNotice(): void {
  const candidates = useExtensionUpdatesStore.getState().candidates
  const direct = candidates.filter((c) => c.Tier !== 'unverified')
  const held = candidates.length - direct.length
  void (async () => {
    let done = 0
    for (const c of direct) {
      try {
        await PluginService.UpdatePlugin(c.ID)
        done++
      } catch (err) {
        pushNotice({ level: 'error', text: i18n.t('views:extensions.updates.updateFailed', { name: c.Name || c.ID, error: messageFor(err, appTranslate) }) })
      }
    }
    if (done > 0) notifyPluginRemoved()
    await refreshUpdates()
    const parts = [
      done > 0 ? i18n.t('views:extensions.updates.updatedAll', { count: done }) : '',
      held > 0 ? i18n.t('views:extensions.updates.heldForAcknowledgment', { count: held }) : '',
    ].filter(Boolean)
    if (parts.length > 0) pushNotice({ level: held > 0 ? 'info' : 'success', text: parts.join(' ') })
  })()
}
