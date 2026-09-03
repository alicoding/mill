import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@primer/react'
import type { Card, Kind } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { childrenOf } from './atlasGrouping'
import { isGroupCard } from './atlasBoardLayout'
import { capPageEntries, eagerPreviewIDs, orderContentChildren } from './atlasCardPageContent'
import { AtlasCardMirrorPreview } from './AtlasCardMirrorPreview'
import { UnitRenderSlot } from './UnitRenderSlot'
import { resolveUnit } from './atlasUnits'
import styles from './AtlasCardPage.module.css'

// The page's own Contents column (goal 0072 slice C, narrowed by goal
// 0081 slice A5's "read is edit"): a summary of what this card
// CONTAINS -- its own mirrored file content, then its children
// ("Inside"). Note used to render here as read-only text and links as
// a merged "Link" entry list; both moved out (Note is now the editable
// field above this column, links are now AtlasSlotRows below it) so a
// value is never shown twice on the same page, once read-only and once
// editable.
//
// A leaf child row navigates exactly like a slot-row chip (LOCKED
// design §5b, extended live): onChildClick IS AtlasCardOverlay's own
// nav.navigate, the SAME function passed to AtlasSlotRows' onChipClick
// -- one navigation implementation, two entry points, never a second
// copy of the push-onto-the-stack logic. A group child row keeps its
// EXISTING, different onOpenGroupEntry behavior (closes the page,
// re-roots the board) -- that's goal 0072 slice C's own drill
// semantics, not chip-style in-place navigation, and stays untouched.
export function AtlasCardPageContents({ card, allCards, kinds, onOpenGroupEntry, onChildClick }: {
  card: Card
  allCards: Card[]
  kinds: Kind[]
  onOpenGroupEntry: (target: Card) => void
  onChildClick: (cardID: string) => void
}) {
  const { t } = useTranslation('atlas')
  const kindByID = new Map(kinds.map((k) => [k.ID, k]))

  const childEntries = orderContentChildren(allCards, card.ID)
  const isEmpty = !card.MirrorPath && childEntries.length === 0 && !card.ProjectionListID
  // The board-unit registry (ADR-0043, goal 0133 slice 1) resolves
  // this card's own content unit -- the same table-projection/mirror
  // priority chain deriveFileTag's tag now reads too, so this column's
  // renderer and the header's file-tag chip can never disagree.
  const unit = resolveUnit(card)

  // Not persisted -- unmounted with the overlay on close, so a
  // reopened page always starts collapsed again rather than carrying
  // an expand/load state that no longer matches what's actually
  // scrolled into view.
  const [expanded, setExpanded] = useState(false)
  const [loadedPreviewIDs, setLoadedPreviewIDs] = useState<Set<string>>(new Set())
  const { visible, hiddenCount } = capPageEntries(childEntries, 12)
  const rendered = expanded ? childEntries : visible
  // Derived from the FULL, uncapped child list -- which children
  // preview eagerly must stay stable whether or not "Show more" has
  // been clicked, not shift as more entries scroll into view.
  const eagerIDs = eagerPreviewIDs(childEntries, 3)

  const loadPreview = (childID: string) => {
    setLoadedPreviewIDs((prev) => new Set(prev).add(childID))
  }

  // The calm page renders this whole column ONLY when there's
  // something to show (goal 0106 slice B contract item 3): no "Nothing
  // inside yet" fallback -- a childless, unmirrored card's page simply
  // never mounts this section, matching the acceptance bar's "no
  // empty sections." Placed after every hook above so a card that
  // gains/loses its last child while this page stays open (a live
  // refreshAtlas() update, not a remount) never changes this
  // component's own hook-call order between renders.
  if (isEmpty) return null

  return (
    <div className={styles.contentsCol} data-testid="atlas-page-contents">
      {unit?.render.Page && <UnitRenderSlot loader={unit.render.Page} card={card} />}

      {rendered.map((child) => {
        const kind = kindByID.get(child.KindID)
        // Cards-only ([], []) -- same deliberate divergence
        // atlasCardPageContent.ts's orderContentChildren records.
        const isGroup = isGroupCard(allCards, child, [], [])
        if (isGroup) {
          const count = childrenOf(allCards, child.ID).length
          return (
            <div
              key={child.ID}
              className={`${styles.entry} ${styles.groupEntry}`}
              data-testid="atlas-page-child-group"
              role="button"
              tabIndex={0}
              aria-label={t('page.openGroupAriaLabel', { title: child.Title })}
              onClick={() => onOpenGroupEntry(child)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onOpenGroupEntry(child)
              }}
            >
              <div>
                <div className={styles.entryEyebrow}>{t('page.insideEyebrow', { kind: kind?.Label ?? '' })}</div>
                <div className={styles.entryTitle}>{child.Title}</div>
              </div>
              <span className={styles.groupEntryChip}>{t('page.cardsChip', { count })}</span>
            </div>
          )
        }
        const showPreview = child.MirrorPath && (eagerIDs.has(child.ID) || loadedPreviewIDs.has(child.ID))
        return (
          <div
            key={child.ID}
            className={styles.entry}
            data-testid="atlas-page-child"
            role="button"
            tabIndex={0}
            aria-label={t('page.openGroupAriaLabel', { title: child.Title })}
            onClick={() => onChildClick(child.ID)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onChildClick(child.ID)
            }}
          >
            <div className={styles.entryEyebrow}>{t('page.insideEyebrow', { kind: kind?.Label ?? '' })}</div>
            <div className={styles.entryTitle}>{child.Title}</div>
            {child.MirrorPath && (
              showPreview ? (
                <div className={styles.entryMirror} data-testid="atlas-page-child-mirror" onClick={(e) => e.stopPropagation()}>
                  <AtlasCardMirrorPreview cardID={child.ID} mirrorPath={child.MirrorPath} />
                </div>
              ) : (
                <Button
                  variant="invisible"
                  size="small"
                  className={styles.loadPreviewButton}
                  data-testid="atlas-page-load-preview"
                  onClick={(e) => {
                    e.stopPropagation()
                    loadPreview(child.ID)
                  }}
                >
                  {t('page.loadPreview')}
                </Button>
              )
            )}
          </div>
        )
      })}

      {!expanded && hiddenCount > 0 && (
        <Button
          variant="invisible"
          block
          className={styles.showMoreRow}
          data-testid="atlas-page-show-more"
          onClick={() => setExpanded(true)}
        >
          {t('page.showMore', { count: hiddenCount })}
        </Button>
      )}
    </div>
  )
}
