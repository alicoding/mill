import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { Handle, Position as RFPosition } from '@xyflow/react'
import type { NodeProps, Node as RFNode } from '@xyflow/react'
import type { Card } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { kindColorTokens } from './atlasKindColor'
import { NOTE_HEIGHT, NOTE_WIDTH } from './atlasBoardLayout'
import type { FreshnessRollup } from './atlasCardPresentation'
import { useAtlasDragHighlight } from './atlasDragHighlightContext'
import styles from './AtlasGroupNode.module.css'
import slotStyles from './AtlasSlotRows.module.css'

export interface AtlasGroupData extends Record<string, unknown> {
  card: Card
  childCount: number
  freshness: FreshnessRollup
  // A ⌘K jump landing on this frame (goal 0072 slice B) -- same
  // meaning as AtlasNoteCardData's own pulsed/hinted.
  pulsed: boolean
  hinted: boolean
  // The click model's own commit test (goal 0102's gesture table):
  // true when this frame was the sole selected node before the
  // current click gesture began -- see useAtlasSelection.ts's own
  // header comment.
  isSoleSelected: (id: string) => boolean
  // Semantic zoom (goal 0073): set when the preview cap truncated this
  // frame's children -- where the "+ K more" ghost tile renders, in
  // the frame's own coordinate space.
  overflow: { count: number; position: { x: number; y: number } } | null
  // A slot-drag is live and this frame is a legal drop target too
  // (goal 0124 slice 2) -- an area IS a card, and can hold a link the
  // same way a leaf card can.
  slotDragHighlight: boolean
  onDrill: (id: string) => void
  onOpenOverlay: (id: string) => void
}

export type AtlasGroupRFNode = RFNode<AtlasGroupData>

// A region frame (goal 0072 slice A, re-cut by goal 0106's flip
// retirement): a card holding cards, drawn as a bordered/tinted frame
// with its own children rendered as separate React Flow nodes on top
// (parentId + extent:'parent', built by AtlasBoard) -- this component
// renders only the frame's own chrome (background/border/header),
// never the children themselves. The header is the ONLY drill
// affordance available unconditionally; the frame's own BODY follows
// the uniform click model (goal 0102): a click on an already-selected
// frame's body commits too (the same zoom the header always offers).
export const AtlasGroupNode = memo(function AtlasGroupNode({ data }: NodeProps<AtlasGroupRFNode>) {
  const { t } = useTranslation('atlas')
  const { card, childCount, freshness, pulsed, hinted, isSoleSelected, overflow, slotDragHighlight, onDrill, onOpenOverlay } = data
  const tokens = kindColorTokens(card.KindID)
  // Drag filing's own live release-target affordance (goal 0081 slice
  // A2): read from the narrowly-scoped context (goal 0161 slice 1)
  // rather than a node data field, so only frame nodes re-render on a
  // boundary crossing.
  const dragHighlighted = useAtlasDragHighlight() === card.ID

  const drill = (e: { stopPropagation: () => void }) => {
    e.stopPropagation()
    onDrill(card.ID)
  }
  // The click model (goal 0102's gesture table): shift-click is React
  // Flow's own multi-select toggle; ⌘-click opens this place's own
  // page directly (the pointer twin of ⌘↵); a plain click on the
  // ALREADY-selected frame commits -- a place's commit is zooming in,
  // the same drill the header always offers. Every other plain click
  // just lets React Flow's own select-and-replace stand.
  const bodyClick = (e: { metaKey: boolean; ctrlKey: boolean; shiftKey: boolean }) => {
    if (e.shiftKey) return
    if (e.metaKey || e.ctrlKey) { onOpenOverlay(card.ID); return }
    if (isSoleSelected(card.ID)) onDrill(card.ID)
  }

  return (
    <div
      className={`${styles.frame}${slotDragHighlight ? ` ${slotStyles.slotTargetHighlight}` : ''}`}
      data-testid="atlas-group-card"
      data-pulse={pulsed}
      data-drag-highlight={dragHighlighted}
      data-slot-target={slotDragHighlight}
      // Not a widget role itself (WCAG's no-nested-interactive-controls
      // requirement, axe-core's nested-interactive rule): the header
      // below is the frame's one real keyboard-focusable control and
      // already fires the identical zoom action, so the frame body
      // stays a plain click target (bodyClick still fires on a mouse
      // click regardless of role/tabIndex) rather than a second,
      // redundant tab stop announcing the same label twice.
      style={{ borderColor: `var(${tokens.fg})`, background: `var(${tokens.muted})` }}
      onClick={bodyClick}
    >
      {/* Invisible connection points, same reasoning as AtlasNoteCardNode's
          own Handle pair -- a link naming this region frame's own card
          as an endpoint needs a real measured Handle to attach to. */}
      <Handle type="target" position={RFPosition.Top} className={styles.handle} />
      <Handle type="source" position={RFPosition.Bottom} className={styles.handle} />

      <div
        className={styles.header}
        data-testid="atlas-group-header"
        role="button"
        tabIndex={0}
        aria-label={t('board.zoomIntoAriaLabel', { title: card.Title })}
        onClick={drill}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            e.stopPropagation()
            onDrill(card.ID)
          }
        }}
      >
        <span className={styles.name}>{card.Title}</span>
        <span className={styles.cardCount}>{t('board.cardsCount', { count: childCount })}</span>
        {freshness.fresh > 0 && (
          <span className={`${styles.pill} ${styles.pillFresh}`} data-testid="atlas-group-fresh-pill">
            {t('board.freshChip', { count: freshness.fresh })}
          </span>
        )}
        {freshness.stale > 0 && (
          <span className={`${styles.pill} ${styles.pillStale}`} data-testid="atlas-group-stale-pill">
            {t('board.staleChip', { count: freshness.stale })}
          </span>
        )}
        <span className={styles.zoomChip}>{t('board.zoomChip')}</span>
      </div>
      {/* The "+ K more" ghost tile (goal 0073): the preview cap's
          honest remainder, occupying the note-sized slot the layout
          reserved for it. Clicking it is the same act as the header
          -- zoom into the place to see everything. */}
      {overflow && (
        <button
          type="button"
          className={`${styles.overflowTile} nodrag nopan`}
          data-testid="atlas-group-overflow"
          style={{ left: overflow.position.x, top: overflow.position.y, width: NOTE_WIDTH, height: NOTE_HEIGHT }}
          onClick={drill}
        >
          {t('board.moreTile', { count: overflow.count })}
        </button>
      )}

      {hinted && (
        <div className={styles.hintChip} data-testid="atlas-jump-hint" aria-hidden="true">{t('board.jumpHint')}</div>
      )}
    </div>
  )
})
