import { useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Events } from '@wailsio/runtime'
import { SettingsService, UpdateState } from '../shared/bindings'
import { findCommand } from '../shared/commands'
import { refreshUpdateNoticeState, useUpdateNoticeStore } from '../shared/updateNoticeStore'
import styles from './NoticePill.module.css'

// The app-notice pill (goal 0122, state-unified goal 0220 S1): renders
// the ONE update state machine (SettingsService.UpdateNoticeState),
// nothing else, and every click RUNS the matching shared/commands.ts
// command -- the same code path the Settings primary button uses, so
// pill and page can never disagree and never navigate instead of
// acting. idle/checking render nothing (Settings is where "check for
// updates" lives when nothing is already in flight); available runs
// update.downloadAndInstall; downloading is a static progress badge
// (no action while a download is in flight); ready runs update.relaunch,
// unchanged from before this goal. shared/updateNoticeStore.ts (goal
// 0222 S1) is the multi-purpose seam now -- the same store the
// update.downloadAndInstall/update.relaunch commands read their own
// enabled() off, so pill/palette/keyboard can never disagree about
// which action currently applies.
export function NoticePill() {
  const { t } = useTranslation('app')
  const state = useUpdateNoticeStore((s) => s.updateNoticeState)

  const refresh = useCallback(() => { void refreshUpdateNoticeState() }, [])

  useEffect(() => {
    refresh()
    return Events.On('mill-data-changed', (evt) => {
      const entity = (evt.data as { entity?: string })?.entity
      if (entity === 'update-notice') refresh()
    })
  }, [refresh])

  if (state === UpdateState.UpdateStateReady) {
    return (
      <button
        type="button"
        className={`${styles.pill} ${styles.ready}`}
        onClick={() => findCommand('update.relaunch')?.run()}
        data-testid="notice-update-ready"
      >
        {t('noticePill.updateReady')}
      </button>
    )
  }
  if (state === UpdateState.UpdateStateDownloading) {
    return (
      <span className={`${styles.pill} ${styles.downloading}`} data-testid="notice-update-downloading">
        {t('noticePill.updateDownloading')}
      </span>
    )
  }
  if (state === UpdateState.UpdateStateAvailable) {
    return (
      <span className={`${styles.pill} ${styles.available}`} data-testid="notice-update-available">
        <button
          type="button"
          className={styles.pillAction}
          onClick={() => findCommand('update.downloadAndInstall')?.run()}
        >
          {t('noticePill.updateAvailable')}
        </button>
        <button
          type="button"
          className={styles.dismiss}
          aria-label={t('noticePill.dismissAriaLabel')}
          onClick={() => void SettingsService.DismissUpdateNotice()}
          data-testid="notice-dismiss"
        >
          ×
        </button>
      </span>
    )
  }
  return null
}
