import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Heading, FormControl, Stack, Text, TextInput } from '@primer/react'
import { SettingsService } from '../shared/bindings'
import listStyles from '../shared/ListCard.module.css'
import styles from './SettingsView.module.css'

// Settings > Security's third section (goal 0351 Decision 4): the one
// shared cap over the whole audit trail (MCP calls, secret reads,
// browser bridge activity) -- replaces the two per-source caps that
// preceded it, both hardcoded at the same number, with one setting a
// reader can see and change.
export default function SettingsAuditRetention() {
  const { t } = useTranslation('secrets')
  const [saved, setSaved] = useState<number | null>(null)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    SettingsService.GetAuditRetentionEntries()
      .then((n) => {
        setSaved(n)
        setDraft(String(n))
      })
      .catch((err) => setError(String(err)))
  }, [])

  // Stored only once the field holds a whole positive number, the same
  // "don't save a half-typed value" guard SecretsLockingSettings' own
  // custom-minutes field uses.
  const typeCap = (raw: string) => {
    setDraft(raw)
    const n = Number(raw)
    if (!Number.isInteger(n) || n <= 0) return
    setError('')
    SettingsService.SetAuditRetentionEntries(n)
      .then(() => setSaved(n))
      .catch((err) => setError(String(err)))
  }

  if (saved === null) return null

  return (
    <>
      <Stack direction="vertical" gap="none">
        <Heading as="h2" variant="small" className={styles.paneSectionHeading} data-testid="settings-section-heading">
          {t('sections.audit')}
        </Heading>
        <Text as="p" size="small" className={listStyles.muted}>{t('sections.auditSubtitle')}</Text>
      </Stack>
      <FormControl>
        <FormControl.Label>{t('auditRetention.label')}</FormControl.Label>
        <TextInput
          type="number"
          min={1}
          value={draft}
          onChange={(e) => typeCap(e.target.value)}
          data-testid="audit-retention-input"
        />
        <FormControl.Caption>{t('auditRetention.caption')}</FormControl.Caption>
      </FormControl>
      {error && <Text as="p" size="small" className={listStyles.error} data-testid="settings-audit-retention-error">{error}</Text>}
    </>
  )
}
