import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Stack, Text } from '@primer/react'
import type { Card, Kind, Link, LinkKind } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { childrenOf } from './atlasGrouping'
import { isGroupCard } from './atlasBoardLayout'
import {
  capPageEntries,
  eagerPreviewIDs,
  isPersonKind,
  orderContentChildren,
  orderContentLinks,
  personInitial,
  type ContentLink,
} from './atlasCardPageContent'
import { kindColorTokens } from './atlasKindColor'
import { AtlasCardMirrorPreview } from './AtlasCardMirrorPreview'
import runbookStyles from '../shared/ListCard.module.css'
import styles from './AtlasCardPage.module.css'

// A page entry is either an "Inside" child or a "Link" -- merged into
// one ordered list (children first, then links, matching the order
// each used to render in separately) so the entry cap (goal 0073
// slice B) counts and truncates across BOTH uniformly, rather than
// capping each column independently and still growing unbounded
// together.
type PageEntry = { kind: 'child'; child: Card } | { kind: 'link'; entry: ContentLink }

// The page's own Contents column (goal 0072 slice C): the card's own
// note/mirror content first, then its children ("Inside"), then its
// links ("Link") -- each rendered by what it IS, per the ratified
// anatomy. Read-only; every edit affordance lives in the edit section
// below it (AtlasCardOverlay's own composition), never here.
export function AtlasCardPageContents({ card, allCards, kinds, links, linkKinds, onOpenGroupEntry }: {
  card: Card
  allCards: Card[]
  kinds: Kind[]
  links: Link[]
  linkKinds: LinkKind[]
  onOpenGroupEntry: (target: Card) => void
}) {
  const { t } = useTranslation('atlas')
  const kindByID = new Map(kinds.map((k) => [k.ID, k]))
  const cardByID = new Map(allCards.map((c) => [c.ID, c]))
  const linkKindByID = new Map(linkKinds.map((lk) => [lk.ID, lk]))

  const childEntries = orderContentChildren(allCards, card.ID)
  const linkEntries = orderContentLinks(links, card.ID, cardByID, linkKindByID)
  const isEmpty = !card.Note && !card.MirrorPath && childEntries.length === 0 && linkEntries.length === 0

  const merged: PageEntry[] = [
    ...childEntries.map((child): PageEntry => ({ kind: 'child', child })),
    ...linkEntries.map((entry): PageEntry => ({ kind: 'link', entry })),
  ]
  // Not persisted -- unmounted with the overlay on close, so a
  // reopened page always starts collapsed again rather than carrying
  // an expand/load state that no longer matches what's actually
  // scrolled into view.
  const [expanded, setExpanded] = useState(false)
  const [loadedPreviewIDs, setLoadedPreviewIDs] = useState<Set<string>>(new Set())
  const { visible, hiddenCount } = capPageEntries(merged, 12)
  const rendered = expanded ? merged : visible
  // Derived from the FULL, uncapped child list -- which children
  // preview eagerly must stay stable whether or not "Show more" has
  // been clicked, not shift as more entries scroll into view.
  const eagerIDs = eagerPreviewIDs(childEntries, 3)

  const loadPreview = (childID: string) => {
    setLoadedPreviewIDs((prev) => new Set(prev).add(childID))
  }

  return (
    <div className={styles.contentsCol} data-testid="atlas-page-contents">
      {card.Note && <Text as="p" className={styles.ownNote} data-testid="atlas-page-note">{card.Note}</Text>}

      {card.MirrorPath && (
        <Stack direction="vertical" gap="condensed" data-testid="atlas-card-mirror-content">
          <Text weight="semibold">{t('overlay.mirrorContentHeading')}</Text>
          <AtlasCardMirrorPreview cardID={card.ID} mirrorPath={card.MirrorPath} />
        </Stack>
      )}

      {rendered.map((item) => {
        if (item.kind === 'child') {
          const child = item.child
          const kind = kindByID.get(child.KindID)
          const isGroup = isGroupCard(allCards, child)
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
            <div key={child.ID} className={styles.entry} data-testid="atlas-page-child">
              <div className={styles.entryEyebrow}>{t('page.insideEyebrow', { kind: kind?.Label ?? '' })}</div>
              <div className={styles.entryTitle}>{child.Title}</div>
              {child.MirrorPath && (
                showPreview ? (
                  <div className={styles.entryMirror} data-testid="atlas-page-child-mirror">
                    <AtlasCardMirrorPreview cardID={child.ID} mirrorPath={child.MirrorPath} />
                  </div>
                ) : (
                  <Button
                    variant="invisible"
                    size="small"
                    className={styles.loadPreviewButton}
                    data-testid="atlas-page-load-preview"
                    onClick={() => loadPreview(child.ID)}
                  >
                    {t('page.loadPreview')}
                  </Button>
                )
              )}
            </div>
          )
        }

        const { link, other, linkKind } = item.entry
        const contact = other ? isPersonKind(other.KindID) : false
        const tokens = other ? kindColorTokens(other.KindID) : undefined
        return (
          <div key={link.ID} className={styles.entry} data-testid="atlas-page-link" data-contact={contact}>
            <div className={styles.entryEyebrow}>{t('page.linkEyebrow', { kind: linkKind?.Label ?? link.LinkKindID })}</div>
            {contact && other && tokens ? (
              <div className={styles.personRow} data-testid="atlas-page-link-person">
                <span className={styles.personAvatar} style={{ background: `var(${tokens.emphasis})` }}>
                  {personInitial(other.Title)}
                </span>
                <span className={styles.entryTitle}>{other.Title}</span>
              </div>
            ) : (
              <>
                <div className={styles.entryTitle}>{other?.Title ?? ''}</div>
                {other?.Note && <div className={styles.entryNoteLine}>{other.Note}</div>}
              </>
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

      {isEmpty && <Text as="p" className={`${runbookStyles.muted} ${styles.emptyContents}`} data-testid="atlas-page-empty-contents">{t('page.emptyContents')}</Text>}
    </div>
  )
}
