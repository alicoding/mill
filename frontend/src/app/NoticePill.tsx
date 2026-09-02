import { useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Events } from '@wailsio/runtime'
import { findCommand } from '../shared/commands'
import type { Notice } from '../shared/noticeStore'
import { useNoticeStore } from '../shared/noticeStore'
import { updateNotices } from '../shared/updateNotices'
import { refreshUpdateNoticeState, useUpdateNoticeStore } from '../shared/updateNoticeStore'
import styles from './NoticePill.module.css'

// The app-notice pill (goal 0122; state-unified goal 0220 S1; made the
// generic notice renderer by goal 0277): renders every Notice the
// footer currently carries -- the update state machine's own states
// (derived by shared/updateNotices.ts, unchanged in behavior: the
// primary action RUNS the matching registry command, so pill and
// Settings page can never disagree) and anything pushed through
// shared/noticeStore.ts (a plugin's api.notify). One look per level,
// one shape per notice: optional source label, the text (a button
// when a primary command exists), lighter secondary links, and a
// dismiss × when the notice is dismissible.
export function NoticePill() {
  const { t } = useTranslation('app')
  const state = useUpdateNoticeStore((s) => s.updateNoticeState)
  const userCheck = useUpdateNoticeStore((s) => s.userCheck)
  const pushed = useNoticeStore((s) => s.notices)

  const refresh = useCallback(() => { void refreshUpdateNoticeState() }, [])

  useEffect(() => {
    refresh()
    return Events.On('mill-data-changed', (evt) => {
      const entity = (evt.data as { entity?: string })?.entity
      if (entity === 'update-notice') refresh()
    })
  }, [refresh])

  const notices = [...updateNotices(state, userCheck, t), ...pushed]
  if (notices.length === 0) return null
  return <>{notices.map((n) => <NoticeView key={n.id} notice={n} dismissLabel={t('noticePill.dismissAriaLabel')} />)}</>
}

const LEVEL_CLASS: Record<Notice['level'], string> = {
  success: styles.success,
  info: styles.info,
  progress: styles.progress,
  warning: styles.warning,
  error: styles.error,
}

function NoticeView({ notice, dismissLabel }: { notice: Notice; dismissLabel: string }) {
  return (
    <span className={`${styles.pill} ${LEVEL_CLASS[notice.level]}`} data-testid={`notice-${notice.id}`} data-notice-level={notice.level}>
      {notice.source && <span className={styles.source} data-testid="notice-source">{notice.source}</span>}
      {notice.primaryCommandId ? (
        <button type="button" className={styles.pillAction} onClick={() => findCommand(notice.primaryCommandId ?? '')?.run()}>
          {notice.text}
        </button>
      ) : (
        <span className={styles.text}>{notice.text}</span>
      )}
      {notice.actions?.map((a) => (
        <button key={a.commandId} type="button" className={styles.secondaryAction} onClick={() => findCommand(a.commandId)?.run()} data-testid={a.id ? `notice-${a.id}` : 'notice-action'}>
          {a.label}
        </button>
      ))}
      {notice.onDismiss && (
        <button type="button" className={styles.dismiss} aria-label={dismissLabel} onClick={notice.onDismiss} data-testid="notice-dismiss">
          ×
        </button>
      )}
    </span>
  )
}
