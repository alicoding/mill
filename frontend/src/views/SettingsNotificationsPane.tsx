import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Text, TextInput } from '@primer/react'
import { SettingsService } from '../shared/bindings'
import { SettingsRow } from './SettingsRow'
import listStyles from '../shared/ListCard.module.css'
import { background } from '../shared/background'

// Where the rest of the trimmed away/alert captions lives (goal 0321).
const SETTINGS_DOCS_PAGE = 'reference/settings.md'

// Settings > Notifications (goal 0321): when a parked decision is
// allowed to follow you, and what macOS does with the alert when it
// does.
export default function SettingsNotificationsPane() {
  const { t } = useTranslation('views')
  // docs/goals/0023-attention-escalation.md item 2: the idle-aware
  // presence-gate threshold. null only until the mount fetch resolves.
  const [idleThreshold, setIdleThresholdState] = useState<number | null>(null)
  const [loadError, setLoadError] = useState(false)

  useEffect(() => {
    SettingsService.GetAttentionIdleThreshold()
      .then(setIdleThresholdState)
      .catch((err) => { console.error(err); setLoadError(true) })
  }, [])

  // Committed on blur (a numeric field on every keystroke would spam
  // SetAttentionIdleThreshold with half-typed values) -- a
  // non-positive/empty value resets to the backend's own default,
  // mirrored client-side by simply refetching.
  const commitIdleThreshold = (raw: string) => {
    const n = parseInt(raw, 10)
    void background(SettingsService.SetAttentionIdleThreshold(Number.isFinite(n) ? n : 0)
      .then(() => SettingsService.GetAttentionIdleThreshold())
      .then(setIdleThresholdState), 'settingsNotificationsPane.getAttentionIdleThreshold')
  }

  return (
    <>
      {loadError && (
        <Text as="p" size="small" className={listStyles.error} data-testid="settings-load-error">
          {t('settings.loadError')}
        </Text>
      )}
      <SettingsRow
        label={t('settings.notifications.awayAfterLabel')}
        caption={t('settings.notifications.awayAfterCaption')}
        docsPage={SETTINGS_DOCS_PAGE}
        control={(labelId) => (
          <TextInput
            className={listStyles.themedNumberInput}
            type="number"
            min={1}
            defaultValue={idleThreshold ?? undefined}
            key={idleThreshold ?? 'loading'}
            onBlur={(e) => commitIdleThreshold(e.target.value)}
            disabled={idleThreshold === null}
            aria-labelledby={labelId}
            data-testid="attention-idle-threshold-input"
            size="small"
          />
        )}
      />
      <SettingsRow
        label={t('settings.notifications.alertPermissionLabel')}
        caption={t('settings.notifications.alertPermissionNote')}
        docsPage={SETTINGS_DOCS_PAGE}
      />
    </>
  )
}
