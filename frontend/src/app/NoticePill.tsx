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
// updates" lives when nothing is already in flight); available's
// PRIMARY action runs update.downloadAndInstall; downloading has no
// primary action while the download is in flight; ready's primary runs
// update.relaunch -- all three unchanged from goal 0220 S1. Every
// rendered state also carries WhatsNewLink, a SECONDARY action (goal
// 0220 S2) that only ever opens app/WhatsNewDialog.tsx, never competing
// with the state's own primary action. shared/updateNoticeStore.ts
// (goal 0222 S1) is the multi-purpose seam now -- the same store the
// update.downloadAndInstall/update.relaunch commands read their own
// enabled() off, so pill/palette/keyboard can never disagree about
// which action currently applies.
export function NoticePill() {
  const { t } = useTranslation('app')
  const state = useUpdateNoticeStore((s) => s.updateNoticeState)
  const userCheck = useUpdateNoticeStore((s) => s.userCheck)
  const dismissUserCheckNotice = useUpdateNoticeStore((s) => s.dismissUserCheckNotice)

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
      <span className={`${styles.pill} ${styles.ready}`} data-testid="notice-update-ready">
        <button type="button" className={styles.pillAction} onClick={() => findCommand('update.relaunch')?.run()}>
          {t('noticePill.updateReady')}
        </button>
        <WhatsNewLink />
      </span>
    )
  }
  if (state === UpdateState.UpdateStateDownloading) {
    return (
      <span className={`${styles.pill} ${styles.downloading}`} data-testid="notice-update-downloading">
        {t('noticePill.updateDownloading')}
        <WhatsNewLink />
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
        <WhatsNewLink />
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
  // User-run check outcomes (goal 0275): rendered only when no server
  // state above claimed the pill, and only for a check the USER
  // started (updateNoticeStore.userCheck) -- automatic checks stay
  // silent here exactly as before.
  if (userCheck === 'checking') {
    return (
      <span className={`${styles.pill} ${styles.downloading}`} data-testid="notice-update-checking">
        {t('noticePill.checking')}
      </span>
    )
  }
  if (userCheck === 'upToDate') {
    return (
      <span className={`${styles.pill} ${styles.downloading}`} data-testid="notice-update-uptodate">
        {t('noticePill.upToDate')}
      </span>
    )
  }
  if (userCheck === 'failed') {
    return (
      <span className={`${styles.pill} ${styles.failed}`} data-testid="notice-update-check-failed">
        <button type="button" className={styles.pillAction} onClick={() => findCommand('settings.open')?.run()}>
          {t('noticePill.checkFailed')}
        </button>
        <button
          type="button"
          className={styles.dismiss}
          aria-label={t('noticePill.dismissAriaLabel')}
          onClick={() => dismissUserCheckNotice()}
          data-testid="notice-check-failed-dismiss"
        >
          ×
        </button>
      </span>
    )
  }
  return null
}

// The pill's secondary action (goal 0220 S2): every rendered state
// shares this one link, always running update.whatsNew -- the pill's
// own primary action (download/relaunch) never changes shape because
// of it, matching this goal's own "primary action stays exactly as S1
// shipped it" contract.
function WhatsNewLink() {
  const { t } = useTranslation('app')
  return (
    <button
      type="button"
      className={styles.whatsNewLink}
      onClick={() => findCommand('update.whatsNew')?.run()}
      data-testid="notice-whats-new"
    >
      {t('noticePill.whatsNew')}
    </button>
  )
}
