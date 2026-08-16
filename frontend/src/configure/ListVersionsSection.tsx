import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Stack, Text } from '@primer/react'
import { StatusStamp } from '../shared/StatusStamp'
import { ConfigureService } from '../shared/bindings'
import type { List } from '../../bindings/github.com/alicoding/mill/internal/domain/list/models'
import styles from '../shared/ListCard.module.css'

// The List edit form's own Versions section (docs/adr/0040 decision 4,
// goal 0070): mirrors DecisionVersionsSection.tsx exactly -- a List has
// the identical no-rollback-controls shape (list-lookup/list-search's
// unpinned resolution always reads the live draft regardless of what's
// published, list.Resolve's own doc comment).
export function ListVersionsSection({ list, onPublished }: {
  list: List
  onPublished: () => void
}) {
  const { t } = useTranslation('configure')
  const [error, setError] = useState('')

  const publish = () => {
    setError('')
    ConfigureService.PublishList(list.ID)
      .then(onPublished)
      .catch((err) => setError(String(err)))
  }

  const versions = [...(list.Versions ?? [])].sort((a, b) => b.Version - a.Version)

  return (
    <Stack direction="vertical" gap="condensed" data-testid="list-versions-section">
      <Text size="small" weight="semibold">{t('configureLists.versions.heading')}</Text>
      <Stack direction="horizontal" gap="condensed" align="center">
        {list.PublishedVersion > 0 ? (
          <StatusStamp variant="success" data-testid="list-published-badge">
            {t('configureLists.versions.publishedAt', { version: list.PublishedVersion })}
          </StatusStamp>
        ) : (
          <StatusStamp variant="caution" data-testid="list-published-badge">
            {t('configureLists.versions.neverPublished')}
          </StatusStamp>
        )}
        <Button size="small" onClick={publish} data-testid="publish-list">
          {t('configureLists.versions.publish')}
        </Button>
      </Stack>
      {error && <Text as="p" size="small" className={styles.error}>{error}</Text>}
      {versions.length > 0 && (
        <Stack direction="vertical" gap="condensed" data-testid="list-versions-list">
          {versions.map((v) => (
            <Stack key={v.Version} direction="horizontal" gap="condensed" align="center">
              <Text size="small">{t('configureLists.versions.versionPrefix', { version: v.Version })}</Text>
              {v.Version === list.PublishedVersion && (
                <StatusStamp variant="success">{t('configureLists.versions.live')}</StatusStamp>
              )}
            </Stack>
          ))}
        </Stack>
      )}
    </Stack>
  )
}
