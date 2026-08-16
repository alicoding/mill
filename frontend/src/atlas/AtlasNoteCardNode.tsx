import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { Handle, Position as RFPosition } from '@xyflow/react'
import type { NodeProps, Node as RFNode } from '@xyflow/react'
import { ArrowUpRightIcon } from '@primer/octicons-react'
import type { Card, Kind, Link, LinkKind } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { kindColorTokens } from './atlasKindColor'
import { basenameOf, daysSinceSync, deriveFileTag, freshnessDotColor, hostnameOf } from './atlasCardPresentation'
import { childrenOf } from './atlasGrouping'
import styles from './AtlasNoteCardNode.module.css'

export interface AtlasNoteCardData extends Record<string, unknown> {
  card: Card
  kind: Kind | undefined
  allCards: Card[]
  links: Link[]
  linkKinds: LinkKind[]
  flipped: boolean
  // A ⌘K jump landing on this card (goal 0072 slice B): pulsed drives
  // the accent ring, hinted shows the transient "press Enter to open"
  // chip -- both timed and cleared by AtlasBoard, this component only
  // renders their current on/off state.
  pulsed: boolean
  hinted: boolean
  onToggleFlip: (id: string) => void
  onOpenOverlay: (id: string) => void
  // Double-click's commit (goal 0074): unflips, then opens this
  // leaf's page -- wired by AtlasBoard so the unflip and the open
  // share one state owner.
  onCommit: (id: string) => void
}

export type AtlasNoteCardRFNode = RFNode<AtlasNoteCardData>

// The uniform 190x128 note card (goal 0072 slice A): a book-metaphor
// flip in place on click -- board/camera never moves, exactly one card
// flipped at a time (state lives one level up, in AtlasBoard, so a
// second card's click can unflip the first). Used both as a top-level
// leaf node and as a region frame's own one-level-deep children
// preview -- the same face content either way.
export const AtlasNoteCardNode = memo(function AtlasNoteCardNode({ data }: NodeProps<AtlasNoteCardRFNode>) {
  const { t } = useTranslation('atlas')
  const { card, kind, allCards, links, linkKinds, flipped, pulsed, hinted, onToggleFlip, onOpenOverlay, onCommit } = data
  const tokens = kindColorTokens(card.KindID)
  const fileTag = deriveFileTag(card)
  const dot = freshnessDotColor(card)
  const childCount = childrenOf(allCards, card.ID).length
  const cardLinks = links.filter((l) => l.FromCardID === card.ID || l.ToCardID === card.ID)
  const cardByID = new Map(allCards.map((c) => [c.ID, c]))
  const linkKindByID = new Map(linkKinds.map((lk) => [lk.ID, lk]))
  const firstLink = cardLinks[0]
  const firstLinkOther = firstLink ? cardByID.get(firstLink.FromCardID === card.ID ? firstLink.ToCardID : firstLink.FromCardID) : undefined
  const firstLinkKind = firstLink ? linkKindByID.get(firstLink.LinkKindID) : undefined

  return (
    <div
      className={styles.flipScene}
      data-testid="atlas-note-card"
      data-flipped={flipped}
      data-pulse={pulsed}
      role="button"
      tabIndex={0}
      aria-label={t('board.flipCardAriaLabel', { title: card.Title })}
      // ⌘-click is the pointer twin of ⌘↵ (goal 0074): open the page
      // immediately, no flip step -- the same modifier meaning the
      // jump already carries.
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey) onCommit(card.ID)
        else onToggleFlip(card.ID)
      }}
      // The gesture model (goal 0074): click glances, double-click
      // commits -- for a leaf, the commit is its page. The commit
      // supersedes the glance, so the double-click's own two single
      // clicks having toggled the flip doesn't matter: onCommit
      // unflips before opening.
      onDoubleClick={(e) => {
        e.stopPropagation()
        onCommit(card.ID)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onToggleFlip(card.ID)
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
      <div className={styles.flipInner} data-flipped={flipped}>
        <div className={styles.face} data-testid="atlas-note-card-front">
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
        </div>

        <div className={styles.face} data-testid="atlas-note-card-back">
          <div className={styles.backEyebrow}>{t('board.flipSideEyebrow', { kind: kind?.Label ?? '' })}</div>
          <div className={styles.backNote}>{card.Note || card.Title}</div>
          {card.Source && <div className={styles.backRow}>{t('board.sourceRow', { host: hostnameOf(card.Source) })}</div>}
          {card.MirrorPath && (
            <div className={styles.backRow}>
              {t('board.mirrorRow', {
                name: basenameOf(card.MirrorPath),
                status:
                  dot === 'fresh'
                    ? t('board.mirrorStatusFresh')
                    : t('board.mirrorStatusStale', { days: daysSinceSync(card.LastSyncedAt) }),
              })}
            </div>
          )}
          {firstLink && (
            <div className={styles.backRow}>
              {t('board.linkRow', { kind: firstLinkKind?.Label ?? firstLink.LinkKindID, title: firstLinkOther?.Title ?? '' })}
              {cardLinks.length > 1 && ` ${t('board.moreLinks', { count: cardLinks.length - 1 })}`}
            </div>
          )}
          <button
            type="button"
            className={`${styles.openButton} nodrag nopan`}
            data-testid="atlas-note-open"
            onClick={(e) => {
              e.stopPropagation()
              onOpenOverlay(card.ID)
            }}
          >
            {t('board.open')}
            <ArrowUpRightIcon size={12} />
          </button>
        </div>
      </div>
      {hinted && (
        // A sibling of .flipInner, not a child -- the flip's own 3D
        // rotateY transform must never carry this chip along with it,
        // whichever face is currently showing.
        <div className={styles.hintChip} data-testid="atlas-jump-hint" aria-hidden="true">{t('board.jumpHint')}</div>
      )}
    </div>
  )
})
