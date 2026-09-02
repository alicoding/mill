import { useEffect } from 'react'
import { UpdateState } from '../shared/bindings'
import { useUpdateNoticeStore } from '../shared/updateNoticeStore'

// The update door's outcome in the Quick Panel footer (goal 0295):
// "Check for updates" used to run silently here, and an update already
// in hand was invisible until its row was scrolled to. Every state
// transition now says what happened and which row comes next.
export function useQuickPanelUpdateStatus(setStatus: (text: string | null) => void, t: (key: string, opts?: Record<string, unknown>) => string): void {
  const userCheck = useUpdateNoticeStore((s) => s.userCheck)
  const state = useUpdateNoticeStore((s) => s.updateNoticeState)
  const availableVersion = useUpdateNoticeStore((s) => s.availableVersion)
  const currentVersion = useUpdateNoticeStore((s) => s.currentVersion)
  useEffect(() => {
    if (userCheck === 'checking') setStatus(t('quickPanel.update.checking'))
    else if (userCheck === 'failed') setStatus(t('quickPanel.update.failed'))
    else if (state === UpdateState.UpdateStateAvailable) setStatus(t('quickPanel.update.available', { version: availableVersion }))
    else if (state === UpdateState.UpdateStateDownloading) setStatus(t('quickPanel.update.downloading', { version: availableVersion }))
    else if (state === UpdateState.UpdateStateReady) setStatus(t('quickPanel.update.ready', { version: availableVersion }))
    else if (userCheck === 'upToDate') setStatus(t('quickPanel.update.upToDate', { version: currentVersion }))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setStatus/t are stable; this reacts to the update states only
  }, [userCheck, state, availableVersion, currentVersion])
}
