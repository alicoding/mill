import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { Handle, Position as RFPosition } from '@xyflow/react'
import type { NodeProps, Node as RFNode } from '@xyflow/react'
import { ArrowUpRightIcon } from '@primer/octicons-react'
import type { Card, Kind, Link, LinkKind } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { kindColorTokens } from './atlasKindColor'
import { NOTE_HEIGHT, NOTE_WIDTH } from './atlasBoardLayout'
import type { FreshnessRollup } from './atlasCardPresentation'
import styles from './AtlasGroupNode.module.css'

export interface AtlasGroupData extends Record<string, unknown> {
  card: Card
  kind: Kind | undefined
  allCards: Card[]
  links: Link[]
  linkKinds: LinkKind[]
  childCount: number
  freshness: FreshnessRollup
  // A ⌘K jump landing on this frame (goal 0072 slice B) -- same
  // meaning as AtlasNoteCardData's own pulsed/hinted.
  pulsed: boolean
  hinted: boolean
  // The frame's own back-face flip (goal 0072 slice C item 4, the
  // deferred slice-A residual): flipped/onToggleFlip share the SAME
  // one-flipped-at-a-time state AtlasBoard already keeps for note
  // cards, so opening a frame's back unflips whichever note card (or
  // other frame) was flipped before it.
  flipped: boolean
  // Semantic zoom (goal 0073): set when the preview cap truncated this
  // frame's children -- where the "+ K more" ghost tile renders, in
  // the frame's own coordinate space.
  overflow: { count: number; position: { x: number; y: number } } | null
  onDrill: (id: string) => void
  onToggleFlip: (id: string) => void
  onOpenOverlay: (id: string) => void
}

export type AtlasGroupRFNode = RFNode<AtlasGroupData>

// A region frame (goal 0072 slice A): a card holding cards, drawn as a
// bordered/tinted frame with its own children rendered as separate
// React Flow nodes on top (parentId + extent:'parent', built by
// AtlasBoard) -- this component renders only the frame's own chrome
// (background/border/header), never the children themselves. The
// header is the ONLY drill affordance; a click on the frame's own BODY
// (goal 0072 slice C item 4) flips it in place instead, covering the
// children with a back-face summary -- the header's own onClick stops
// propagation so drilling and flipping never both fire from one click.
export const AtlasGroupNode = memo(function AtlasGroupNode({ data }: NodeProps<AtlasGroupRFNode>) {
  const { t } = useTranslation('atlas')
  const { card, kind, allCards, links, linkKinds, childCount, freshness, pulsed, hinted, flipped, overflow, onDrill, onToggleFlip, onOpenOverlay } = data
  const tokens = kindColorTokens(card.KindID)
  const cardLinks = links.filter((l) => l.FromCardID === card.ID || l.ToCardID === card.ID)
  const cardByID = new Map(allCards.map((c) => [c.ID, c]))
  const linkKindByID = new Map(linkKinds.map((lk) => [lk.ID, lk]))
  const firstLink = cardLinks[0]
  const firstLinkOther = firstLink ? cardByID.get(firstLink.FromCardID === card.ID ? firstLink.ToCardID : firstLink.FromCardID) : undefined
  const firstLinkKind = firstLink ? linkKindByID.get(firstLink.LinkKindID) : undefined

  const drill = (e: { stopPropagation: () => void }) => {
    e.stopPropagation()
    onDrill(card.ID)
  }
  const toggleFlip = () => onToggleFlip(card.ID)

  return (
    <div
      className={styles.frame}
      data-testid="atlas-group-card"
      data-pulse={pulsed}
      data-flipped={flipped}
      role="button"
      tabIndex={0}
      aria-label={t('board.flipCardAriaLabel', { title: card.Title })}
      style={{ borderColor: `var(${tokens.fg})`, background: `var(${tokens.muted})` }}
      onClick={toggleFlip}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          toggleFlip()
        }
      }}
    >
      {/* Invisible connection points, same reasoning as AtlasNoteCardNode's
          own Handle pair -- a link naming this region frame's own card
          as an endpoint needs a real measured Handle to attach to. */}
      <Handle type="target" position={RFPosition.Top} className={styles.handle} />
      <Handle type="source" position={RFPosition.Bottom} className={styles.handle} />

      {/* The frame's own body flip (goal 0072 slice C item 4): the same
          3D rotateY the note card uses, applied to the frame's own
          chrome only -- the externally-positioned children (separate
          React Flow nodes) never rotate, they're simply covered by the
          now-opaque back face once it's on top (AtlasBoard's own
          zIndex bump on the flipped node, above). */}
      <div className={styles.flipInner} data-flipped={flipped}>
        <div className={styles.frontFace} data-testid="atlas-group-card-front">
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
        </div>

        <div className={styles.backFace} data-testid="atlas-group-card-back">
          <div className={styles.backEyebrow}>{t('board.flipSideEyebrow', { kind: kind?.Label ?? '' })}</div>
          <div className={styles.backNote}>{card.Note || card.Title}</div>
          <div className={styles.backRow}>{t('page.cardsChip', { count: childCount })}</div>
          {firstLink && (
            <div className={styles.backRow}>
              {t('board.linkRow', { kind: firstLinkKind?.Label ?? firstLink.LinkKindID, title: firstLinkOther?.Title ?? '' })}
              {cardLinks.length > 1 && ` ${t('board.moreLinks', { count: cardLinks.length - 1 })}`}
            </div>
          )}
          <button
            type="button"
            className={`${styles.openButton} nodrag nopan`}
            data-testid="atlas-group-open"
            onClick={(e) => {
              e.stopPropagation()
              onOpenOverlay(card.ID)
            }}
          >
            {t('page.openGroupPage')}
            <ArrowUpRightIcon size={12} />
          </button>
        </div>
      </div>

      {hinted && (
        <div className={styles.hintChip} data-testid="atlas-jump-hint" aria-hidden="true">{t('board.jumpHint')}</div>
      )}
    </div>
  )
})
