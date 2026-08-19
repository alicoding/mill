import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Events } from '@wailsio/runtime'
import { Text } from '@primer/react'
import { AtlasService } from '../shared/bindings'
import type { ListProjection } from '../../bindings/github.com/alicoding/mill/internal/services/atlassvc/models'
import styles from './AtlasCardProjectionTable.module.css'

// The projected List rendered as a read-only table (goal 0105): used
// by the board's table node AND the card page -- one definition, so
// both surfaces always agree. Data is fetched live and re-fetched on
// every persisted List change (the List is local source of truth, so
// the projection is simply live -- no staleness chrome by design).
export function AtlasCardProjectionTable({ cardID }: { cardID: string }) {
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
  const columns = proj.Columns ?? []
  const rows = proj.Rows ?? []
  return (
    // nowheel/nodrag: the table scrolls without zooming or dragging
    // the canvas underneath it (React Flow's own utility classes).
    <div className={`${styles.scroll} nowheel nodrag`} data-testid="atlas-projection-table">
      {rows.length === 0 ? (
        <Text as="p" size="small" className={styles.empty}>{t('projection.noRows')}</Text>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              {columns.map((c) => <th key={c.Key}>{c.Label || c.Key}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i}>
                {columns.map((c) => <td key={c.Key}>{row?.[c.Key] ?? ''}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
