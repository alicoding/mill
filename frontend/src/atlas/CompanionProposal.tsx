import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Checkbox, FormControl, Stack, Text } from '@primer/react'
import type { ClipbridgeReplyPreview } from '../shared/bindings'

interface Props {
  preview: ClipbridgeReplyPreview
  accepted: boolean
  busy: boolean
  onAccept: (accepted: Set<number>) => void
}

// The companion's own proposal card -- the same review-plane language
// QuickPanelReplyReview.tsx renders (creates default-checked,
// collisions default-unchecked and named, a counted Accept), kept as
// its own small component rather than extracted from that one:
// QuickPanelReplyReview owns its confirm flow's workflow-run IPC and
// async completion state directly, so pulling a shared piece out would
// mean either duplicating that coupling here or reworking the quick
// panel's own behavior -- out of scope for goal 0101 slice 1 (reported
// in the PR, not silently done). This component is purely
// presentational: the accept decision and its IPC call live in
// useCompanionChat.ts.
export function CompanionProposal({ preview, accepted, busy, onAccept }: Props) {
  const { t } = useTranslation('atlas')
  const cards = preview.Cards ?? []
  const notes = preview.NoteTexts ?? []
  const isNoteRoute = notes.length > 0
  const [checked, setChecked] = useState<Set<number>>(
    () => new Set(cards.map((c, i) => (c.CollidesWithID ? -1 : i)).filter((i) => i >= 0)),
  )
  const acceptedCount = isNoteRoute ? notes.length : checked.size

  if (accepted) {
    return <Text size="small" data-testid="companion-proposal-accepted">{t('companionPanel.accepted')}</Text>
  }

  return (
    <Stack gap="condensed" data-testid="companion-proposal">
      {isNoteRoute ? (
        <Stack gap="condensed">
          {notes.map((text, i) => <Text key={i}>{text}</Text>)}
        </Stack>
      ) : (
        <Stack gap="condensed">
          {cards.map((offer, i) => (
            <FormControl key={i}>
              <Checkbox
                checked={checked.has(i)}
                onChange={() => setChecked((prev) => {
                  const next = new Set(prev)
                  if (next.has(i)) next.delete(i); else next.add(i)
                  return next
                })}
                data-testid="companion-proposal-checkbox"
              />
              <FormControl.Label>
                {offer.Draft.title}
                {offer.Draft.kind ? ` · ${offer.Draft.kind}` : ''}
              </FormControl.Label>
              {offer.CollidesWithID ? (
                <FormControl.Caption data-testid="companion-proposal-collision">
                  {t('companionPanel.collision', { kind: offer.CollidesWithKind || t('companionPanel.collisionGenericKind') })}
                </FormControl.Caption>
              ) : offer.Draft.note ? (
                <FormControl.Caption>{offer.Draft.note}</FormControl.Caption>
              ) : null}
            </FormControl>
          ))}
        </Stack>
      )}
      <Button
        variant="primary"
        size="small"
        disabled={busy || acceptedCount === 0}
        onClick={() => onAccept(checked)}
        data-testid="companion-proposal-accept"
        block
      >
        {isNoteRoute ? t('companionPanel.confirmNote') : t('companionPanel.confirmCards', { count: acceptedCount })}
      </Button>
    </Stack>
  )
}
