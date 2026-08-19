import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { Handle, Position as RFPosition } from '@xyflow/react'
import type { NodeProps, Node as RFNode } from '@xyflow/react'
import type { Card, Kind, Link, LinkKind } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { kindColorTokens } from './atlasKindColor'
import { deriveFileTag, freshnessDotColor } from './atlasCardPresentation'
import { childrenOf } from './atlasGrouping'
import styles from './AtlasNoteCardNode.module.css'
import slotStyles from './AtlasSlotRows.module.css'
import type { PointerEvent as ReactPointerEvent } from 'react'

export interface AtlasNoteCardData extends Record<string, unknown> {
  card: Card
  kind: Kind | undefined
  allCards: Card[]
  links: Link[]
  linkKinds: LinkKind[]
  // A ⌘K jump landing on this card (goal 0072 slice B): pulsed drives
  // the accent ring, hinted shows the transient "press Enter to open"
  // chip -- both timed and cleared by AtlasBoard, this component only
  // renders their current on/off state.
  pulsed: boolean
  hinted: boolean
  // The click model's own commit test (goal 0102's gesture table):
  // true when this card was the sole selected node before the current
  // click gesture began -- see useAtlasSelection.ts's own header
  // comment.
  isSoleSelected: (id: string) => boolean
  // A leaf's commit (goal 0102/0106): opens this card's own page.
  // Reached by ⌘-click (instant), or a plain click on an
  // already-selected card -- a natural double-click is just those two
  // clicks in a row, so no separate dblclick handler exists.
  onCommit: (id: string) => void
  // The typed-link slot-drag's own relocated origin (goal 0106
  // contract item 1): a hover-visible handle on the card's right edge,
  // dragging from it starts a link of the board's default (first-
  // declared) kind -- useAtlasSlotDrag owns the gesture, this
  // component only reports where it started.
  slotDragHighlight: boolean
  onSlotAnchorPointerDown: (linkKindID: string, e: ReactPointerEvent) => void
  // Handle honesty (goal 0124 slice 2): false when this board has no
  // other card the handle could ever connect to -- the handle stays
  // in the DOM (recognition: never remove it outright) but renders
  // disabled rather than inviting a drag that can only ever no-op.
  hasLegalTargets: boolean
}

export type AtlasNoteCardRFNode = RFNode<AtlasNoteCardData>

// The uniform 190x128 note card (goal 0072 slice A, re-cut by goal
// 0106's flip retirement): a single face, no back, no in-place rotate.
// Used both as a top-level leaf node and as a region frame's own
// one-level-deep children preview -- the same content either way.
export const AtlasNoteCardNode = memo(function AtlasNoteCardNode({ data }: NodeProps<AtlasNoteCardRFNode>) {
  const { t } = useTranslation('atlas')
  const { card, kind, allCards, links, linkKinds, pulsed, hinted, isSoleSelected, onCommit, slotDragHighlight, onSlotAnchorPointerDown, hasLegalTargets } = data
  const tokens = kindColorTokens(card.KindID)
  const fileTag = deriveFileTag(card)
  const dot = freshnessDotColor(card)
  const childCount = childrenOf(allCards, card.ID).length
  const cardLinks = links.filter((l) => l.FromCardID === card.ID || l.ToCardID === card.ID)
  const defaultLinkKindID = linkKinds[0]?.ID

  return (
    <div
      className={`${styles.card}${slotDragHighlight ? ` ${slotStyles.slotTargetHighlight}` : ''}`}
      data-testid="atlas-note-card"
      data-pulse={pulsed}
      data-slot-target={slotDragHighlight}
      role="button"
      tabIndex={0}
      aria-label={t('board.cardAriaLabel', { title: card.Title })}
      // The click model (goal 0102's gesture table, uniform across
      // every node type): shift-click is React Flow's own multi-select
      // toggle (never also a commit); ⌘-click commits instantly (the
      // pointer twin of ⌘↵); a plain click on the ALREADY-selected
      // card commits too -- so two ordinary clicks in a row reproduce
      // a double-click's outcome with no separate handler needed.
      // Every other plain click just lets React Flow's own
      // select-and-replace stand.
      onClick={(e) => {
        if (e.shiftKey) return
        if (e.metaKey || e.ctrlKey) { onCommit(card.ID); return }
        if (isSoleSelected(card.ID)) onCommit(card.ID)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onCommit(card.ID)
        }
      }}
    >
      {/* Invisible connection points -- React Flow measures a real
          Handle element's DOM position to compute where a link edge
          attaches; without one, an edge naming this card as an
          endpoint silently fails to render. nodesConnectable={false}
          on the board already stops these from starting a NEW drag
          connection. */}
      <Handle type="target" position={RFPosition.Top} className={styles.handle} />
      <Handle type="source" position={RFPosition.Bottom} className={styles.handle} />
      <div className={styles.frontHeader}>
        <span className={styles.glyph} style={{ background: `var(${tokens.emphasis})` }}>
          {(kind?.Label ?? '?').charAt(0).toUpperCase()}
        </span>
        <span className={styles.kindLabel}>{kind?.Label ?? ''}</span>
        {fileTag && (
          <span className={`${styles.fileTag} ${styles[`fileTag-${fileTag.color}`]}`} data-testid="atlas-note-file-tag">
            {fileTag.label}
          </span>
        )}
      </div>
      <div className={styles.title}>{card.Title}</div>
      {card.Note && <div className={styles.noteLine}>{card.Note}</div>}
      <div className={styles.presenceRow}>
        {dot && <span className={`${styles.dot} ${styles[`dot-${dot}`]}`} data-testid="atlas-note-freshness-dot" />}
        {cardLinks.length > 0 && (
          <span className={styles.chip} data-testid="atlas-note-links-chip">{t('board.linksChip', { count: cardLinks.length })}</span>
        )}
        {childCount > 0 ? (
          <span className={styles.chip} data-testid="atlas-note-child-chip">{'▸'} {childCount}</span>
        ) : (
          <span className={styles.chip} data-testid="atlas-note-leaf-chip">{t('board.leafChip')}</span>
        )}
      </div>
      {defaultLinkKindID && (
        <span
          className={`${styles.linkHandle} nodrag nopan`}
          data-testid="atlas-note-link-handle"
          data-disabled={!hasLegalTargets}
          role="button"
          tabIndex={-1}
          aria-label={t('board.slotDragToAdd')}
          aria-disabled={!hasLegalTargets}
          title={hasLegalTargets ? undefined : t('board.slotDragDisabledTitle')}
          onPointerDown={(e) => {
            e.stopPropagation()
            if (!hasLegalTargets) return
            onSlotAnchorPointerDown(defaultLinkKindID, e)
          }}
        />
      )}
      {hinted && (
        <div className={styles.hintChip} data-testid="atlas-jump-hint" aria-hidden="true">{t('board.jumpHint')}</div>
      )}
    </div>
  )
})
