import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, FormControl, IconButton, Select, Stack, Text } from '@primer/react'
import { TrashIcon } from '@primer/octicons-react'
import type { Card, Link, LinkKind } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import runbookStyles from '../shared/ListCard.module.css'

// A card's existing links (each showing its LinkKind label + the OTHER
// card's title, docs/goals/0061) plus add/remove -- a card picker +
// link-kind picker, both plain Selects (EntityRefField's own idiom, one
// level simpler since Atlas links are never a quick-create target --
// the two cards and the link kind must already exist).
export function AtlasCardOverlayLinks({ card, allCards, links, linkKinds, onAdd, onRemove }: {
  card: Card
  allCards: Card[]
  links: Link[]
  linkKinds: LinkKind[]
  onAdd: (toCardID: string, linkKindID: string) => Promise<void>
  onRemove: (linkID: string) => Promise<void>
}) {
  const { t } = useTranslation('atlas')
  const cardByID = new Map(allCards.map((c) => [c.ID, c]))
  const linkKindByID = new Map(linkKinds.map((lk) => [lk.ID, lk]))
  const cardLinks = links.filter((l) => l.FromCardID === card.ID || l.ToCardID === card.ID)
  const pickable = allCards.filter((c) => c.ID !== card.ID)

  const [toCardID, setToCardID] = useState('')
  const [linkKindID, setLinkKindID] = useState('')
  const [adding, setAdding] = useState(false)

  const addLink = async () => {
    if (!toCardID || !linkKindID) return
    setAdding(true)
    try {
      await onAdd(toCardID, linkKindID)
      setToCardID('')
      setLinkKindID('')
    } finally {
      setAdding(false)
    }
  }

  return (
    <Stack direction="vertical" gap="condensed" data-testid="atlas-card-links">
      <Text weight="semibold">{t('overlay.linksHeading')}</Text>
      {cardLinks.length === 0 && (
        <Text as="p" size="small" className={runbookStyles.muted}>{t('overlay.noLinks')}</Text>
      )}
      {cardLinks.map((link) => {
        const otherID = link.FromCardID === card.ID ? link.ToCardID : link.FromCardID
        const other = cardByID.get(otherID)
        const linkKind = linkKindByID.get(link.LinkKindID)
        return (
          <Stack key={link.ID} direction="horizontal" gap="condensed" align="center" data-testid="atlas-link-row">
            <Text size="small">{linkKind?.Label ?? link.LinkKindID}</Text>
            <Text size="small" weight="semibold">{other?.Title ?? otherID}</Text>
            <IconButton
              icon={TrashIcon}
              aria-label={t('overlay.removeLinkAriaLabel', { title: other?.Title ?? otherID })}
              size="small"
              variant="invisible"
              onClick={() => void onRemove(link.ID)}
            />
          </Stack>
        )
      })}
      <Stack direction="horizontal" gap="condensed" align="center">
        <FormControl>
          <FormControl.Label visuallyHidden>{t('overlay.linkTargetLabel')}</FormControl.Label>
          <Select value={toCardID} data-testid="atlas-link-target" onChange={(e) => setToCardID(e.target.value)}>
            <Select.Option value="">{t('overlay.selectCard')}</Select.Option>
            {pickable.map((c) => (
              <Select.Option key={c.ID} value={c.ID}>{c.Title}</Select.Option>
            ))}
          </Select>
        </FormControl>
        <FormControl>
          <FormControl.Label visuallyHidden>{t('overlay.linkKindLabel')}</FormControl.Label>
          <Select value={linkKindID} data-testid="atlas-link-kind" onChange={(e) => setLinkKindID(e.target.value)}>
            <Select.Option value="">{t('overlay.selectLinkKind')}</Select.Option>
            {linkKinds.map((lk) => (
              <Select.Option key={lk.ID} value={lk.ID}>{lk.Label}</Select.Option>
            ))}
          </Select>
        </FormControl>
        <Button size="small" data-testid="atlas-add-link" disabled={adding || !toCardID || !linkKindID} onClick={() => void addLink()}>
          {t('overlay.addLink')}
        </Button>
      </Stack>
    </Stack>
  )
}
