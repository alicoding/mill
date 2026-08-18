import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Banner, Button, Checkbox, FormControl, Stack, Text } from '@primer/react'
import { ArrowLeftIcon, CopyIcon } from '@primer/octicons-react'
import { AtlasService, ExecutionService, RunKind } from '../shared/bindings'
import type { ClipbridgeReplyPreview } from '../shared/bindings'
import styles from './QuickPanelClipboardApply.module.css'

// The clipboard bridge's review surface (goal 0099) -- the fourth
// instance of the preview-dialog language (folder import, list-row
// import, and the MCP approval plane are the siblings): every write
// renders as a checkbox row BEFORE anything executes, colliding rows
// default unchecked with their collision named, and the confirm button
// carries the count it will create. Nothing in a reply auto-runs --
// create-class actions get this review, and replace/delete-class
// actions do not exist in the contract yet (clipbridge.MayAutoRun is
// the enforcement, not this component).
//
// The correction loop is re-ask-the-source: "Copy corrected context"
// re-emits the envelope (via AtlasService.CorrectionEnvelope) carrying
// what failed or what was declined, for a fresh reply from the same AI.

interface Props {
  preview: ClipbridgeReplyPreview
  onCancel: () => void
  onApplied: (label: string) => void
}

export function QuickPanelReplyReview({ preview, onCancel, onApplied }: Props) {
  const { t } = useTranslation('app')
  const [busy, setBusy] = useState(false)
  const [confirmError, setConfirmError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const cards = preview.Cards ?? []
  const notes = preview.NoteTexts ?? []
  const [accepted, setAccepted] = useState<Set<number>>(
    () => new Set(cards.map((c, i) => (c.CollidesWithID ? -1 : i)).filter((i) => i >= 0)),
  )

  const copyCorrection = (problems: string[], declined: string[]) => {
    AtlasService.CorrectionEnvelope(problems, declined)
      .then((envelope) => navigator.clipboard.writeText(envelope))
      .then(() => setCopied(true))
      .catch((err) => setConfirmError(String(err)))
  }

  if (!preview.Valid) {
    return (
      <Stack className={styles.panel} gap="condensed" data-testid="quick-panel-reply-invalid">
        <Banner
          variant="critical"
          title={t('quickPanelReplyReview.invalidTitle')}
          description={(preview.Errors ?? []).join('\n') || t('quickPanelReplyReview.invalidFallback')}
        />
        <Button
          leadingVisual={CopyIcon}
          onClick={() => copyCorrection(preview.Errors ?? [], [])}
          data-testid="quick-panel-reply-copy-correction"
          block
        >
          {copied ? t('quickPanelReplyReview.correctionCopied') : t('quickPanelReplyReview.copyCorrection')}
        </Button>
        <Button leadingVisual={ArrowLeftIcon} onClick={onCancel} block>{t('quickPanelClipboardApply.back')}</Button>
      </Stack>
    )
  }

  const isNoteRoute = notes.length > 0
  const acceptedCount = isNoteRoute ? notes.length : accepted.size

  const confirm = () => {
    // Compute the accepted payload into a local value before anything
    // async -- never round-tripped through state after a set call.
    const items = isNoteRoute
      ? notes.map((text) => ({ text }))
      : cards.filter((_, i) => accepted.has(i)).map((c) => ({
        title: c.Draft.title,
        ...(c.Draft.kind ? { kind: c.Draft.kind } : {}),
        ...(c.Draft.note ? { note: c.Draft.note } : {}),
        ...(c.Draft.summary ? { summary: c.Draft.summary } : {}),
      }))
    if (items.length === 0 || !preview.RouteWorkflowID) return
    setBusy(true)
    setConfirmError(null)
    ExecutionService.RunWorkflow(preview.RouteWorkflowID, RunKind.RunKindTest, { items: JSON.stringify(items) })
      .then((summary) => {
        if (summary.status !== 'SUCCESS') {
          setBusy(false)
          setConfirmError(t('quickPanelReplyReview.runFailed', { status: summary.status }))
          return
        }
        onApplied(preview.RouteLabel ?? '')
      })
      .catch((err) => {
        setBusy(false)
        setConfirmError(String(err))
      })
  }

  const declinedTitles = cards.filter((_, i) => !accepted.has(i)).map((c) => c.Draft.title)

  return (
    <Stack className={styles.panel} gap="condensed" data-testid="quick-panel-reply-review">
      <Text weight="semibold">{t('quickPanelReplyReview.title')}</Text>
      {isNoteRoute ? (
        <Stack gap="condensed" data-testid="quick-panel-reply-notes">
          {notes.map((text, i) => (
            <Text key={i} className={styles.note}>{text}</Text>
          ))}
        </Stack>
      ) : (
        <Stack gap="condensed" data-testid="quick-panel-reply-cards">
          {cards.map((offer, i) => (
            <FormControl key={i}>
              <Checkbox
                checked={accepted.has(i)}
                onChange={() => {
                  setAccepted((prev) => {
                    const next = new Set(prev)
                    if (next.has(i)) { next.delete(i) } else { next.add(i) }
                    return next
                  })
                }}
                data-testid="quick-panel-reply-card-checkbox"
              />
              <FormControl.Label>
                {offer.Draft.title}
                {offer.Draft.kind ? ` · ${offer.Draft.kind}` : ''}
              </FormControl.Label>
              {offer.CollidesWithID ? (
                <FormControl.Caption data-testid="quick-panel-reply-collision">
                  {t('quickPanelReplyReview.collision', { kind: offer.CollidesWithKind || t('quickPanelReplyReview.collisionGenericKind') })}
                </FormControl.Caption>
              ) : offer.Draft.note ? (
                <FormControl.Caption>{offer.Draft.note}</FormControl.Caption>
              ) : null}
            </FormControl>
          ))}
        </Stack>
      )}
      {confirmError && <Banner variant="critical" title={t('quickPanelReplyReview.errorTitle')} description={confirmError} />}
      <Stack direction="horizontal" gap="condensed">
        <Button onClick={onCancel} disabled={busy}>{t('quickPanelClipboardApply.cancel')}</Button>
        <Button
          variant="primary"
          onClick={confirm}
          disabled={busy || acceptedCount === 0}
          data-testid="quick-panel-reply-confirm"
          block
        >
          {isNoteRoute
            ? t('quickPanelReplyReview.confirmNote')
            : t('quickPanelReplyReview.confirmCards', { count: acceptedCount })}
        </Button>
      </Stack>
      {declinedTitles.length > 0 && (
        <Button
          leadingVisual={CopyIcon}
          onClick={() => copyCorrection([], declinedTitles)}
          data-testid="quick-panel-reply-copy-correction"
          block
        >
          {copied ? t('quickPanelReplyReview.correctionCopied') : t('quickPanelReplyReview.copyCorrection')}
        </Button>
      )}
    </Stack>
  )
}
