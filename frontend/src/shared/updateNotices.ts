import { UpdateState } from './bindings'
import { SettingsService } from './bindings'
import type { Notice } from './noticeStore'
import { useUpdateNoticeStore } from './updateNoticeStore'

// The update pill's states restated as notices (goal 0277): the
// derivation goal 0122/0220/0275 rendered inline in NoticePill.tsx,
// now a pure function over the same two store fields so the pill is
// one renderer for every notice source. Ids are stable -- each is the
// testid every updates spec already asserts (`notice-<id>`). The
// server-driven update states take the pill; a user-run check's
// transient outcomes render only when no server state claimed it
// (goal 0275's rule, unchanged).
export function updateNotices(
  state: UpdateState,
  userCheck: 'idle' | 'checking' | 'upToDate' | 'failed',
  t: (key: string) => string,
): Notice[] {
  const whatsNew = { id: 'whats-new', label: t('noticePill.whatsNew'), commandId: 'update.whatsNew' }
  switch (state) {
    case UpdateState.UpdateStateReady:
      return [{ id: 'update-ready', level: 'success', text: t('noticePill.updateReady'), primaryCommandId: 'update.relaunch', actions: [whatsNew] }]
    case UpdateState.UpdateStateDownloading:
      return [{ id: 'update-downloading', level: 'progress', text: t('noticePill.updateDownloading'), actions: [whatsNew] }]
    case UpdateState.UpdateStateAvailable:
      return [{
        id: 'update-available',
        level: 'info',
        text: t('noticePill.updateAvailable'),
        primaryCommandId: 'update.downloadAndInstall',
        actions: [whatsNew],
        onDismiss: () => { void SettingsService.DismissUpdateNotice() },
      }]
    default:
      break
  }
  switch (userCheck) {
    case 'checking':
      return [{ id: 'update-checking', level: 'progress', text: t('noticePill.checking') }]
    case 'upToDate':
      return [{ id: 'update-uptodate', level: 'progress', text: t('noticePill.upToDate') }]
    case 'failed':
      return [{
        id: 'update-check-failed',
        level: 'error',
        text: t('noticePill.checkFailed'),
        primaryCommandId: 'settings.open',
        onDismiss: () => useUpdateNoticeStore.getState().dismissUserCheckNotice(),
      }]
    default:
      return []
  }
}
