import { useTranslation } from 'react-i18next'
import { Banner, Button, Label, Stack, Text, TextInput } from '@primer/react'
import type { CommandBlockPreview } from './bindings'
import styles from './CodingLoopSurface.module.css'

interface Props {
  preview: CommandBlockPreview | null
  previewError: string | null
  startError: string | null
  // typedSecrets/onTypedSecretChange (goal 0240 S2): the resolution
  // chain's third source -- a "you'll type it" requirement renders a
  // masked input right here, so Run always carries a resolvable value
  // for every secret this block needs.
  typedSecrets: Record<string, string>
  onTypedSecretChange: (varName: string, value: string) => void
  onRun: () => void
  onCancel: () => void
}

// The Confirm state (docs/goals/0240 design contract, S2 extending
// S1's): the parsed block shown as its real structure, the target
// shell+cwd, every secret this block needs with its resolution SOURCE
// (vault name / shell env / type it here), and the guardrail verdict.
// Primary: Run. Secondary: Cancel.
export function CodingLoopConfirmState({ preview, previewError, startError, typedSecrets, onTypedSecretChange, onRun, onCancel }: Props) {
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
  const secretRequirements = preview.secretRequirements ?? []
  const untypedSecrets = secretRequirements.filter((r) => r.source === 'prompt' && !(typedSecrets[r.varName] ?? '').trim())
  const runDisabled = untypedSecrets.length > 0

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

      {secretRequirements.length > 0 && (
        <Stack gap="condensed" data-testid="coding-loop-confirm-secrets">
          <Text as="p" size="small" weight="semibold">{t('codingLoop.confirm.secrets.heading')}</Text>
          {secretRequirements.map((req) => (
            <Stack key={req.varName} gap="condensed" data-testid={`coding-loop-confirm-secret-${req.varName}`}>
              <Stack direction="horizontal" gap="condensed" align="center" wrap="wrap">
                <code className={styles.stepText}>{req.varName}</code>
                {req.source === 'vault' && (
                  <Label variant="success">{t('codingLoop.confirm.secrets.fromVault', { label: req.vaultLabel })}</Label>
                )}
                {req.source === 'env' && (
                  <Label>{t('codingLoop.confirm.secrets.fromEnv')}</Label>
                )}
              </Stack>
              {req.source === 'prompt' && (
                <Stack gap="none">
                  <TextInput
                    type="password"
                    placeholder={t('codingLoop.confirm.secrets.typePlaceholder')}
                    value={typedSecrets[req.varName] ?? ''}
                    onChange={(e) => onTypedSecretChange(req.varName, e.target.value)}
                    data-testid={`coding-loop-confirm-secret-input-${req.varName}`}
                    block
                  />
                  <Text size="small" className={styles.target}>{t('codingLoop.confirm.secrets.typedHint')}</Text>
                </Stack>
              )}
            </Stack>
          ))}
        </Stack>
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

      {runDisabled && (
        <Text as="p" size="small" className={styles.target} data-testid="coding-loop-confirm-secrets-incomplete">
          {t('codingLoop.confirm.secrets.typeBeforeRun')}
        </Text>
      )}

      <Stack direction="horizontal" gap="condensed" className={styles.actions}>
        <Button onClick={onCancel}>{t('codingLoop.confirm.cancel')}</Button>
        <Button variant="primary" onClick={onRun} disabled={runDisabled} data-testid="coding-loop-confirm-run">
          {t('codingLoop.confirm.run')}
        </Button>
      </Stack>
    </Stack>
  )
}
