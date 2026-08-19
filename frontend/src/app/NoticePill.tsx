import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Events } from '@wailsio/runtime'
import { SettingsService } from '../shared/bindings'
import styles from './NoticePill.module.css'

// The app-notice pill (goal 0122): state-driven, self-clearing, never
// re-fires -- the VS Code badge / Sparkle gentle-reminder shape, not a
// toast and not a notification center. Two consumers today: "Update
// ready — Relaunch" (accent; exists exactly while an installed update
// waits for a restart) and "Update available" (quiet; opens Settings;
// dismissable per version). The notice STORE is the multi-purpose
// seam -- a future notice type is one more emitter, not a new surface.
interface Notice {
  ready: boolean
  availableVersion: string
}

export function NoticePill({ onOpenUpdates }: { onOpenUpdates: () => void }) {
  const { t } = useTranslation('app')
  const [notice, setNotice] = useState<Notice>({ ready: false, availableVersion: '' })

  const refresh = useCallback(() => {
    SettingsService.UpdateNoticeState()
      .then((n) => setNotice({ ready: n.ready, availableVersion: n.availableVersion }))
      .catch(console.error)
  }, [])

  useEffect(() => {
    refresh()
    return Events.On('mill-data-changed', (evt) => {
      const entity = (evt.data as { entity?: string })?.entity
      if (entity === 'update-notice') refresh()
    })
  }, [refresh])

  if (notice.ready) {
    return (
      <button
        type="button"
        className={`${styles.pill} ${styles.ready}`}
        onClick={() => void SettingsService.RestartApp()}
        data-testid="notice-update-ready"
      >
        {t('noticePill.updateReady')}
      </button>
    )
  }
  if (notice.availableVersion) {
    return (
      <span className={`${styles.pill} ${styles.available}`} data-testid="notice-update-available">
        <button type="button" className={styles.pillAction} onClick={onOpenUpdates}>
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
