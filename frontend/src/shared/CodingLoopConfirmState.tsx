import { useTranslation } from 'react-i18next'
import { Banner, Button, Label, Stack, Text } from '@primer/react'
import type { CommandBlockPreview } from './bindings'
import styles from './CodingLoopSurface.module.css'

interface Props {
  preview: CommandBlockPreview | null
  previewError: string | null
  startError: string | null
  onRun: () => void
  onCancel: () => void
}

// The Confirm state (docs/goals/0240 S1's design contract): the parsed
// block shown as its real structure, the target shell+cwd, secrets
// flagged as "will run as-is" (S1 has no resolution chain yet -- that's
// S2), and the guardrail verdict. Primary: Run. Secondary: Cancel.
export function CodingLoopConfirmState({ preview, previewError, startError, onRun, onCancel }: Props) {
  const { t } = useTranslation('app')

  if (previewError) {
    return (
      <Stack gap="condensed" data-testid="coding-loop-confirm-error">
        <Banner variant="critical" title={t('codingLoop.confirm.unreadableTitle')} description={previewError} />
        <Button onClick={onCancel} block>{t('codingLoop.confirm.close')}</Button>
      </Stack>
    )
  }

  if (!preview) {
    return (
      <Stack gap="condensed" align="center" data-testid="coding-loop-confirm-loading">
        <Text size="small">{t('codingLoop.confirm.loading')}</Text>
      </Stack>
    )
  }

  const steps = preview.steps ?? []
  const stepCount = steps.length
  const hasSecretPlaceholder = steps.some((s) => s.looksLikeSecretPlaceholder)

  return (
    <Stack gap="condensed" className={styles.panel} data-testid="coding-loop-confirm">
      <Text as="p" data-testid="coding-loop-confirm-summary">
        {t('codingLoop.confirm.summary', { count: stepCount, plural: stepCount === 1 ? '' : 's' })}
      </Text>
      <Text as="p" size="small" className={styles.target} data-testid="coding-loop-confirm-target">
        {t('codingLoop.confirm.target', { shell: preview.shell, dir: preview.dir })}
      </Text>

      <ol className={styles.stepList} data-testid="coding-loop-confirm-steps">
        {steps.map((step) => (
          <li key={step.index} className={styles.stepRow}>
            <code className={styles.stepText}>{step.text}</code>
            {step.join === 'and' && <Label size="small">{t('codingLoop.confirm.joinAnd')}</Label>}
            {step.join === 'newline' && <Label size="small">{t('codingLoop.confirm.joinNewline')}</Label>}
          </li>
        ))}
      </ol>

      {hasSecretPlaceholder && (
        <Banner
          variant="warning"
          title={t('codingLoop.confirm.secretPlaceholderTitle')}
          description={t('codingLoop.confirm.secretPlaceholderDescription')}
          data-testid="coding-loop-confirm-secret-banner"
        />
      )}

      <Label
        variant={preview.guardrailVerdict === 'deny' ? 'danger' : preview.guardrailVerdict === 'allow' ? 'success' : 'attention'}
        data-testid="coding-loop-confirm-verdict"
      >
        {t(`codingLoop.confirm.verdict.${preview.guardrailVerdict}`)}
      </Label>

      {startError && (
        <Banner variant="critical" title={t('codingLoop.confirm.startFailedTitle')} description={startError} data-testid="coding-loop-confirm-start-error" />
      )}

      <Stack direction="horizontal" gap="condensed" className={styles.actions}>
        <Button onClick={onCancel}>{t('codingLoop.confirm.cancel')}</Button>
        <Button variant="primary" onClick={onRun} data-testid="coding-loop-confirm-run">
          {t('codingLoop.confirm.run')}
        </Button>
      </Stack>
    </Stack>
  )
}
