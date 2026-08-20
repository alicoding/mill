import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Events } from '@wailsio/runtime'
import { Text } from '@primer/react'
import { AtlasService } from '../shared/bindings'
import type { ListProjection } from '../../bindings/github.com/alicoding/mill/internal/services/atlassvc/models'
import { ListGrid } from '../shared/ListGrid'
import styles from './AtlasCardProjectionTable.module.css'

// The projected List on a card (goal 0105): the board's table node
// AND the card page mount the ONE shared grid (shared/ListGrid, goal
// 0136 -- Configure's List page is its other consumer, so tables read
// identically everywhere). This wrapper owns only what's card-shaped:
// the projection fetch (live -- re-fetched on every persisted List
// change), the honest missing-List state, and the canvas armor.
export function AtlasCardProjectionTable({ cardID, density }: { cardID: string; density?: string }) {
  const { t } = useTranslation('atlas')
  const [proj, setProj] = useState<ListProjection | null>(null)

  useEffect(() => {
    const refetch = () => void AtlasService.CardListProjection(cardID).then(setProj).catch(() => setProj(null))
    refetch()
    return Events.On('mill-data-changed', (evt) => {
      const entity = (evt.data as { entity?: string })?.entity
      if (entity === 'list' || entity === 'atlas') refetch()
    })
  }, [cardID])

  if (!proj || proj.ListID === '') return null
  if (proj.Missing) {
    return (
      <Text as="p" size="small" className={styles.missing} data-testid="atlas-projection-missing">
        {t('projection.missingList')}
      </Text>
    )
  }
  return (
    // nowheel/nodrag: the table scrolls and its inputs receive clicks
    // without zooming or dragging the canvas underneath (React Flow's
    // own utility classes; nodrag on the container covers children).
    // stopPropagation: a cell click must never reach the card node's
    // own click model -- a second click inside the table otherwise
    // reads as "commit the selected card" and opens the page over the
    // edit (the spreadsheet-node convention: the frame moves/opens the
    // card, the grid edits the grid).
    <div
      className={`${styles.wrap} nowheel nodrag`}
      onClick={(e) => e.stopPropagation()}
    >
      <ListGrid
        listID={proj.ListID}
        columns={proj.Columns ?? []}
        rows={(proj.Rows ?? []).filter((r) => r !== null)}
        density={density}
      />
    </div>
  )
}
