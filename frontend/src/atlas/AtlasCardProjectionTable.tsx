import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Events } from '@wailsio/runtime'
import { Text } from '@primer/react'
import type { ListProjection } from '../../bindings/github.com/alicoding/mill/internal/services/atlassvc/models'
import { ListGridGlide } from '../shared/ListGridGlide'
import { AtlasTableTitleRow } from './AtlasTableTitleRow'
import styles from './AtlasCardProjectionTable.module.css'

// The projected List on a card OR a board object (goal 0105, widened by
// goal 0179 S2): the board's table node, a table board object's own
// board face, AND the card page all mount the ONE shared grid
// (shared/ListGridGlide, ADR-0049 -- Configure's List page is its other
// consumer, so tables read identically everywhere). This wrapper owns
// only what's projection-shaped: the fetch (live -- re-fetched on
// every persisted List change), the honest missing-List state, and the
// canvas armor. fetchProjection is the caller's own resolver
// (AtlasService.CardListProjection for a card, .ObjectListProjection
// for a board object) -- the ONE piece that differs between the two
// entities a projection can ride on; scopeID is whichever id that
// resolver takes, used only as this effect's own dependency/cache key.
export function AtlasCardProjectionTable({ scopeID, density, fetchProjection, onColumnCount, editorPortal, titleRow, onEditingChange }: {
  editorPortal?: 'body' | 'host'
  // titleRow (goal 0273): a table BOARD OBJECT names itself above its
  // own grid, since nothing else on the board names it. A table CARD
  // passes nothing -- the card's own title already is that name, and a
  // second one inside the body would only repeat it.
  titleRow?: { objectID: string }
  scopeID: string
  density?: string
  fetchProjection: (id: string) => Promise<ListProjection>
  // onColumnCount (goal 0286) tells the host how many columns the
  // projection currently has, so an unsized table object can size its
  // box from the count -- a deterministic width, never intrinsic
  // sizing, which feeds back through the scrollbars into React Flow's
  // node measurement and oscillates.
  onColumnCount?: (count: number) => void
  // onEditingChange (goal 0354): the grid's overlay cell editor opening
  // and closing, reported to whoever hosts this grid. Only a board
  // object supplies it -- a card page's grid has no canvas frame whose
  // input contract depends on it.
  onEditingChange?: (editing: boolean) => void
}) {
  const { t } = useTranslation('atlas')
  const [proj, setProj] = useState<ListProjection | null>(null)

  // Scoped + debounced (goal 0147): a list event names WHICH list
  // changed (dataevent.Emit's id) -- other lists' bursts are free; a
  // burst against THIS list coalesces to one refetch. Atlas events
  // stay unscoped (the projection binding itself may have changed)
  // but ride the same debounce.
  //
  // Leading, not trailing: the first event in a burst refetches
  // IMMEDIATELY, so the row an edit just committed is never read stale
  // by an action that follows it inside the coalescing window (a copy
  // reading the cell's pre-edit value through getCellContent, since
  // that value comes from this component's own `proj` state). Further
  // events during the window still coalesce to exactly one trailing
  // refetch, preserving the burst-coalescing this debounce exists for.
  const projListIDRef = useRef('')
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    let trailingPending = false
    const refetch = () => void fetchProjection(scopeID).then((p) => {
      projListIDRef.current = p.ListID
      setProj(p)
    }).catch(() => setProj(null))
    const schedule = () => {
      if (timer === null) {
        refetch()
        timer = setTimeout(() => {
          timer = null
          if (trailingPending) {
            trailingPending = false
            refetch()
          }
        }, 150)
        return
      }
      trailingPending = true
    }
    refetch()
    const off = Events.On('mill-data-changed', (evt) => {
      const data = evt.data as { entity?: string; id?: string } | undefined
      if (data?.entity === 'atlas') schedule()
      if (data?.entity === 'list' && (!data.id || data.id === projListIDRef.current)) schedule()
    })
    return () => {
      off()
      if (timer !== null) clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fetchProjection is one of the two stable AtlasService bound methods, never a fresh closure per render
  }, [scopeID])

  const columnCount = proj?.Columns?.length ?? 0
  useEffect(() => { onColumnCount?.(columnCount) }, [columnCount, onColumnCount])

  if (!proj || proj.ListID === '') return null
  if (proj.Missing) {
    return (
      <Text as="p" size="small" className={styles.missing} data-testid="atlas-projection-missing">
        {t('projection.missingList')}
      </Text>
    )
  }
  return (
    // nowheel/nodrag/nopan: the table scrolls and its inputs receive
    // clicks without zooming, dragging, or panning the canvas
    // underneath (React Flow's own utility classes; nodrag on the
    // container covers children). nopan matters after a programmatic
    // fly (a reveal): without it the pane's pan gesture captured the
    // pointer on the grid's own pointerdown, so the click composed on
    // the pane and the cell never activated.
    // stopPropagation: a cell click must never reach the card node's
    // own click model -- a second click inside the table otherwise
    // reads as "commit the selected card" and opens the page over the
    // edit (the spreadsheet-node convention: the frame moves/opens the
    // card, the grid edits the grid).
    <div
      className={`${styles.wrap} nowheel nodrag nopan`}
      onClick={(e) => e.stopPropagation()}
    >
      {titleRow && <AtlasTableTitleRow objectID={titleRow.objectID} listID={proj.ListID} label={proj.Label} />}
      <ListGridGlide
        listID={proj.ListID}
        columns={proj.Columns ?? []}
        rows={(proj.Rows ?? []).filter((r) => r !== null)}
        density={density}
        editorPortal={editorPortal}
        onEditingChange={onEditingChange}
      />
    </div>
  )
}
