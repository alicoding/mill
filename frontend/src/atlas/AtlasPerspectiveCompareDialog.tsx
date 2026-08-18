import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ActionList, Dialog, FormControl, Select, Stack, Text } from '@primer/react'
import type { Card, Kind, Link, LinkKind, Perspective, PerspectiveDiff } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { AtlasService } from '../shared/bindings'
import { kindColorTokens } from './atlasKindColor'
import runbookStyles from '../shared/ListCard.module.css'
import styles from './AtlasPerspectiveCompareDialog.module.css'

// The Current->Target diff view (goal 0095 slice 3, ADR-0041): read-
// only set difference between two perspectives' own membership, over
// DiffPerspectives (a thin bound wrapper around the pure
// atlas.DiffPerspectives helper -- internal/services/atlassvc/
// atlasperspective.go). Re-parenting is deliberately never expressed
// here (the ADR's own invariant: a card carries exactly one ParentID
// shared by every perspective) -- rows never navigate in this slice.
export function AtlasPerspectiveCompareDialog({
  open, onClose, perspectives, cards, links, kinds, linkKinds, onError,
}: {
  open: boolean
  onClose: () => void
  perspectives: Perspective[]
  cards: Card[]
  links: Link[]
  kinds: Kind[]
  linkKinds: LinkKind[]
  onError: (message: string) => void
}) {
  const { t } = useTranslation('atlas')
  const [fromID, setFromID] = useState('')
  const [toID, setToID] = useState('')
  const [diff, setDiff] = useState<PerspectiveDiff | null>(null)

  // Defaults to the first two perspectives IN ORDER, reset only on the
  // closed->open transition -- a ref (not a `perspectives` dependency)
  // so an unrelated Atlas store refresh while the dialog is already
  // open never clobbers the user's own From/To choice.
  const perspectivesRef = useRef(perspectives)
  useEffect(() => { perspectivesRef.current = perspectives })
  useEffect(() => {
    if (!open) return
    const list = perspectivesRef.current
    setFromID(list[0]?.ID ?? '')
    setToID(list[1]?.ID ?? '')
  }, [open])

  useEffect(() => {
    if (!open || !fromID || !toID) return
    let cancelled = false
    AtlasService.DiffPerspectives(fromID, toID)
      .then((d) => { if (!cancelled) setDiff(d) })
      .catch((err) => { if (!cancelled) onError(String(err)) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onError is a stable toast setter, not reactive state this fetch depends on.
  }, [open, fromID, toID])

  const cardByID = useMemo(() => new Map(cards.map((c) => [c.ID, c])), [cards])
  const linkByID = useMemo(() => new Map(links.map((l) => [l.ID, l])), [links])
  const kindByID = useMemo(() => new Map(kinds.map((k) => [k.ID, k])), [kinds])
  const linkKindByID = useMemo(() => new Map(linkKinds.map((lk) => [lk.ID, lk])), [linkKinds])

  if (!open) return null

  const resolvedCards = (ids: string[] | null) => (ids ?? []).map((id) => cardByID.get(id)).filter((c): c is Card => !!c)
  const resolvedLinks = (ids: string[] | null) => (ids ?? []).map((id) => linkByID.get(id)).filter((l): l is Link => !!l)

  const addedCards = diff ? resolvedCards(diff.AddedCardIDs) : []
  const removedCards = diff ? resolvedCards(diff.RemovedCardIDs) : []
  const addedLinks = diff ? resolvedLinks(diff.AddedLinkIDs) : []
  const removedLinks = diff ? resolvedLinks(diff.RemovedLinkIDs) : []
  const allEmpty = diff !== null && addedCards.length === 0 && removedCards.length === 0 && addedLinks.length === 0 && removedLinks.length === 0

  const cardRow = (card: Card) => {
    const kind = kindByID.get(card.KindID)
    const tokens = kindColorTokens(card.KindID)
    return (
      <ActionList.Item key={card.ID} data-testid="atlas-compare-card-row">
        <ActionList.LeadingVisual>
          <span className={styles.glyph} style={{ background: `var(${tokens.emphasis})` }}>
            {(kind?.Label ?? '?').charAt(0).toUpperCase()}
          </span>
        </ActionList.LeadingVisual>
        {card.Title}
      </ActionList.Item>
    )
  }

  const linkRow = (link: Link) => (
    <ActionList.Item key={link.ID} data-testid="atlas-compare-link-row">
      {t('compare.linkRow', {
        from: cardByID.get(link.FromCardID)?.Title ?? '?',
        to: cardByID.get(link.ToCardID)?.Title ?? '?',
        kind: linkKindByID.get(link.LinkKindID)?.Label ?? '?',
      })}
    </ActionList.Item>
  )

  return (
    <Dialog title={t('compare.title')} onClose={onClose} data-component="atlas-perspective-compare-dialog">
      <Stack direction="vertical" gap="normal">
        <Stack direction="horizontal" gap="normal">
          <FormControl>
            <FormControl.Label>{t('compare.fromLabel')}</FormControl.Label>
            <Select value={fromID} data-testid="atlas-compare-from" onChange={(e) => setFromID(e.target.value)}>
              {perspectives.map((p) => (
                <Select.Option key={p.ID} value={p.ID}>{p.Name}</Select.Option>
              ))}
            </Select>
          </FormControl>
          <FormControl>
            <FormControl.Label>{t('compare.toLabel')}</FormControl.Label>
            <Select value={toID} data-testid="atlas-compare-to" onChange={(e) => setToID(e.target.value)}>
              {perspectives.map((p) => (
                <Select.Option key={p.ID} value={p.ID}>{p.Name}</Select.Option>
              ))}
            </Select>
          </FormControl>
        </Stack>

        {allEmpty && <Text as="p" size="small" className={runbookStyles.muted} data-testid="atlas-compare-no-changes">{t('compare.noChanges')}</Text>}

        {!allEmpty && (
          <ActionList data-testid="atlas-compare-results">
            {addedCards.length > 0 && (
              <ActionList.Group title={t('compare.addedCardsHeading', { count: addedCards.length })}>
                {addedCards.map(cardRow)}
              </ActionList.Group>
            )}
            {removedCards.length > 0 && (
              <ActionList.Group title={t('compare.removedCardsHeading', { count: removedCards.length })}>
                {removedCards.map(cardRow)}
              </ActionList.Group>
            )}
            {addedLinks.length > 0 && (
              <ActionList.Group title={t('compare.addedLinksHeading', { count: addedLinks.length })}>
                {addedLinks.map(linkRow)}
              </ActionList.Group>
            )}
            {removedLinks.length > 0 && (
              <ActionList.Group title={t('compare.removedLinksHeading', { count: removedLinks.length })}>
                {removedLinks.map(linkRow)}
              </ActionList.Group>
            )}
          </ActionList>
        )}
      </Stack>
    </Dialog>
  )
}
