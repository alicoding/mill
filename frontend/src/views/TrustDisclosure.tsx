import { useTranslation } from 'react-i18next'
import { Button, Stack, Text } from '@primer/react'
import { findCommand } from '../shared/commands'
import { CopyDiagnosisButton } from '../shared/CopyDiagnosisButton'
import { useUpdateNoticeStore } from '../shared/updateNoticeStore'
import styles from '../shared/ListCard.module.css'

// Keeps a rendered error to one humane line -- the same truncation
// UpdatesSection.tsx's own error rows use; CopyDiagnosisButton still
// gets the untruncated text.
function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s
}

// TrustDisclosure renders the "How updates stay trusted" panel: the
// re-sign explainer plus the one button that grants Mill's own signing
// certificate trust directly (goal 0220 S3), replacing the former
// "find it in Keychain Access" hunt. Split out of UpdatesSection.tsx
// to keep that file under CLAUDE.md's 500-line convention.
export function TrustDisclosure() {
  const { t } = useTranslation('views')
  const status = useUpdateNoticeStore((s) => s.trustSigningStatus)
  const error = useUpdateNoticeStore((s) => s.trustSigningError)

  return (
    <details data-testid="trust-disclosure">
      <summary>{t('settings.updates.trustDisclosureSummary')}</summary>
      <Stack gap="condensed">
        <Text size="small" className={styles.muted} data-testid="resign-notice">
          {t('settings.updates.resignNotice')}
        </Text>
        <Text size="small" className={styles.muted} data-testid="resign-setup-notice">
          {t('settings.updates.resignSetupNotice')}
        </Text>
        <Stack direction="horizontal" gap="condensed" align="center">
          <Button
            size="small"
            disabled={status === 'busy'}
            onClick={() => findCommand('update.trustSigning')?.run()}
            data-testid="trust-signing-button"
          >
            {status === 'busy' ? t('settings.updates.trustSigningBusy') : t('settings.updates.trustSigningButton')}
          </Button>
          {status === 'success' && (
            <Text size="small" className={styles.muted} data-testid="trust-signing-success">
              {t('settings.updates.trustSigningSucceeded')}
            </Text>
          )}
        </Stack>
        {status === 'error' && (
          <Stack direction="horizontal" gap="condensed" align="center">
            <Text size="small" className={styles.error} data-testid="trust-signing-error">
              {t('settings.updates.trustSigningFailed', { error: truncate(error, 200) })}
            </Text>
            <CopyDiagnosisButton error={error} testId="trust-signing-error-copy" />
          </Stack>
        )}
      </Stack>
    </details>
  )
}
