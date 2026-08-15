import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ActionList, Button, Dialog, FormControl, Select, Stack, Text } from '@primer/react'
import type { Card, Link, LinkKind } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { coverageMissingLink, coverageMissingMirror } from './atlasProjections'
import runbookStyles from '../shared/ListCard.module.css'

// One stat row: "covered/total", plus a toggle revealing the missing
// cards one click away (each row opens that card's overlay) --
// docs/goals/0064's own "N/M ... one click away" phrasing.
function CoverageStat({ testID, label, missing, onOpenCard }: {
  testID: string
  label: string
  missing: Card[]
  onOpenCard: (id: string) => void
}) {
  const { t } = useTranslation('atlas')
  const [showMissing, setShowMissing] = useState(false)
  return (
    <Stack direction="vertical" gap="condensed" data-testid={testID}>
      <Stack direction="horizontal" gap="condensed" align="center">
        <Text data-testid={`${testID}-value`}>{label}</Text>
        {missing.length > 0 && (
          <Button size="small" variant="invisible" data-testid={`${testID}-toggle`} onClick={() => setShowMissing((v) => !v)}>
            {showMissing ? t('coverage.hideMissing') : t('coverage.viewMissing', { count: missing.length })}
          </Button>
        )}
      </Stack>
      {showMissing && (
        <ActionList data-testid={`${testID}-missing-list`}>
          {missing.map((card) => (
            <ActionList.Item key={card.ID} data-testid="atlas-coverage-missing-item" onSelect={() => onOpenCard(card.ID)}>
              {card.Title}
            </ActionList.Item>
          ))}
        </ActionList>
      )}
    </Stack>
  )
}

// Coverage / ingestion targets (docs/goals/0064, ADR-0038): the
// viewed space's own honest "known, not mapped" counts -- cards
// missing a link of a chosen kind, and cards missing a mirror. Both
// are the same coverage-ratio shape, so CoverageStat above renders
// either.
export function AtlasCoverageView({ open, onClose, cards, links, linkKinds, onOpenCard }: {
  open: boolean
  onClose: () => void
  cards: Card[]
  links: Link[]
  linkKinds: LinkKind[]
  onOpenCard: (id: string) => void
}) {
  const { t } = useTranslation('atlas')
  const [linkKindID, setLinkKindID] = useState(linkKinds[0]?.ID ?? '')

  const linkCoverage = linkKindID ? coverageMissingLink(cards, links, linkKindID) : null
  const mirrorCoverage = coverageMissingMirror(cards)

  if (!open) return null

  return (
    <Dialog title={t('coverage.title')} onClose={onClose} data-component="atlas-coverage-dialog">
      <Stack direction="vertical" gap="normal">
        <Stack direction="vertical" gap="condensed">
          <FormControl>
            <FormControl.Label>{t('coverage.linkKindLabel')}</FormControl.Label>
            <Select value={linkKindID} data-testid="atlas-coverage-link-kind" onChange={(e) => setLinkKindID(e.target.value)}>
              {linkKinds.length === 0 && <Select.Option value="">{t('matrix.anyLinkKind')}</Select.Option>}
              {linkKinds.map((lk) => (
                <Select.Option key={lk.ID} value={lk.ID}>{lk.Label}</Select.Option>
              ))}
            </Select>
          </FormControl>
          {linkCoverage ? (
            <CoverageStat
              testID="atlas-coverage-link"
              label={t('coverage.linkedStat', { covered: linkCoverage.total - linkCoverage.missing.length, total: linkCoverage.total })}
              missing={linkCoverage.missing}
              onOpenCard={onOpenCard}
            />
          ) : (
            <Text as="p" size="small" className={runbookStyles.muted}>{t('coverage.noLinkKinds')}</Text>
          )}
        </Stack>

        <Stack direction="vertical" gap="condensed">
          <Text weight="semibold">{t('coverage.mirrorHeading')}</Text>
          <CoverageStat
            testID="atlas-coverage-mirror"
            label={t('coverage.mirroredStat', { covered: mirrorCoverage.total - mirrorCoverage.missing.length, total: mirrorCoverage.total })}
            missing={mirrorCoverage.missing}
            onOpenCard={onOpenCard}
          />
        </Stack>
      </Stack>
    </Dialog>
  )
}
