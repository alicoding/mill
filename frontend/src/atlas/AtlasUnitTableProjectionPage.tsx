import { useTranslation } from 'react-i18next'
import { Link as PrimerLink, Stack, Text } from '@primer/react'
import { useAppStore } from '../shared/store'
import { AtlasCardProjectionTable } from './AtlasCardProjectionTable'
import type { UnitRenderProps } from './unitRegistry'
import runbookStyles from '../shared/ListCard.module.css'

// The table-projection unit's card-page presentation -- moved here
// unchanged from AtlasCardPageContents.tsx's old hardcoded
// `card.ProjectionListID && (...)` block (goal 0133 slice 1): same
// heading, same live table, same "Open Lists in Configure" caption
// link, same test ids. AtlasCardPageContents now resolves this
// through the registry instead of hand-checking ProjectionListID.
export function AtlasUnitTableProjectionPage({ card }: UnitRenderProps) {
  const { t } = useTranslation('atlas')
  const setView = useAppStore((s) => s.setView)
  return (
    <Stack direction="vertical" gap="condensed" data-testid="atlas-page-projection">
      <Text weight="semibold">{t('projection.pageHeading')}</Text>
      <AtlasCardProjectionTable cardID={card.ID} density={card.ProjectionDensity} />
      <Text size="small" className={runbookStyles.muted}>
        {t('projection.pageCaption')}{' '}
        <PrimerLink as="button" type="button" data-testid="atlas-projection-open-configure" onClick={() => setView({ kind: 'configure', tab: 'lists' })}>
          {t('projection.openInConfigure')}
        </PrimerLink>
      </Text>
    </Stack>
  )
}
