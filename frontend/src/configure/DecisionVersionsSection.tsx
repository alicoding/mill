import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Stack, Text } from '@primer/react'
import { StatusStamp } from '../shared/StatusStamp'
import { ConfigureService } from '../shared/bindings'
import type { Decision } from '../../bindings/github.com/alicoding/mill/internal/domain/decision/models'
import styles from '../shared/ListCard.module.css'

// The Decision edit form's own Versions section (docs/adr/0040 decision
// 4): mirrors WorkflowVersionsPanel's Publish + version-list shape
// (ADR-0021) at the fidelity a Configure entity's simpler create/edit
// form supports -- no rollback/load-into-draft controls, since an
// unpinned decision-outcome node always resolves the live draft
// regardless of what's published (versioning.go's own ResolveOutcome
// doc comment), unlike a Workflow's separate test/triggered run kinds.
export function DecisionVersionsSection({ decision, onPublished }: {
  decision: Decision
  onPublished: () => void
}) {
  const { t } = useTranslation('configure')
  const [error, setError] = useState('')

  const publish = () => {
    setError('')
    ConfigureService.PublishDecision(decision.ID)
      .then(onPublished)
      .catch((err) => setError(String(err)))
  }

  const versions = [...(decision.Versions ?? [])].sort((a, b) => b.Version - a.Version)

  return (
    <Stack direction="vertical" gap="condensed" data-testid="decision-versions-section">
      <Text size="small" weight="semibold">{t('configureDecisions.versions.heading')}</Text>
      <Stack direction="horizontal" gap="condensed" align="center">
        {decision.PublishedVersion > 0 ? (
          <StatusStamp variant="success" data-testid="decision-published-badge">
            {t('configureDecisions.versions.publishedAt', { version: decision.PublishedVersion })}
          </StatusStamp>
        ) : (
          <StatusStamp variant="caution" data-testid="decision-published-badge">
            {t('configureDecisions.versions.neverPublished')}
          </StatusStamp>
        )}
        <Button size="small" onClick={publish} data-testid="publish-decision">
          {t('configureDecisions.versions.publish')}
        </Button>
      </Stack>
      {error && <Text as="p" size="small" className={styles.error}>{error}</Text>}
      {versions.length > 0 && (
        <Stack direction="vertical" gap="condensed" data-testid="decision-versions-list">
          {versions.map((v) => (
            <Stack key={v.Version} direction="horizontal" gap="condensed" align="center">
              <Text size="small">{t('configureDecisions.versions.versionPrefix', { version: v.Version })}</Text>
              {v.Version === decision.PublishedVersion && (
                <StatusStamp variant="success">{t('configureDecisions.versions.live')}</StatusStamp>
              )}
            </Stack>
          ))}
        </Stack>
      )}
    </Stack>
  )
}
