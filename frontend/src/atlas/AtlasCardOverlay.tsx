import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Events } from '@wailsio/runtime'
import { Button, Dialog, FormControl, Link as PrimerLink, Stack, Text, TextInput, Textarea } from '@primer/react'
import { SyncIcon } from '@primer/octicons-react'
import type { Card, Kind, Link, LinkKind } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { AtlasService, ExecutionService } from '../shared/bindings'
import { useAppStore } from '../shared/store'
import { EntityRefField } from '../configure/EntityRefField'
import { formatUpdated } from '../shared/inventorySort'
import { runStatusVariant } from '../shared/runTime'
import { StatusStamp } from '../shared/StatusStamp'
import { AtlasKindChip } from './AtlasKindChip'
import { AtlasFieldsForm } from './AtlasFieldsForm'
import { AtlasCardOverlayLinks } from './AtlasCardOverlayLinks'
import { useConfirmDelete } from '../shared/useConfirmDelete'
import runbookStyles from '../shared/ListCard.module.css'

// The "about" surface (docs/goals/0061): a FULL-SCREEN overlay per card,
// mirroring StepDetailOverlay.tsx's Dialog sizing (owner-specified) --
// title/kind/note/fields/source/mirror/last-synced/refresh-workflow/
// receipt-run-id, plus the links list. Save persists via UpdateCard;
// ParentID/Position/ViewMode never change here (MoveCard/SetPosition/
// SetViewMode own those, driven by drag/drill actions elsewhere).
export function AtlasCardOverlay({ card, kind, allCards, links, linkKinds, onClose, onSaved }: {
  card: Card
  kind: Kind | undefined
  allCards: Card[]
  links: Link[]
  linkKinds: LinkKind[]
  onClose: () => void
  onSaved: () => void
}) {
  const { t } = useTranslation('atlas')
  const requestOpenWorkflow = useAppStore((s) => s.requestOpenWorkflow)
  const [title, setTitle] = useState(card.Title)
  const [note, setNote] = useState(card.Note)
  const [fields, setFields] = useState<Record<string, string>>((card.Fields ?? {}) as Record<string, string>)
  const [source, setSource] = useState(card.Source)
  const [refreshWorkflowID, setRefreshWorkflowID] = useState(card.RefreshWorkflowID)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [updating, setUpdating] = useState(false)
  // Receipt provenance (goal 0061 slice C, ADR-0038 decision 4): the
  // run's live status, fetched whenever card.ReceiptRunID changes and
  // refreshed on every "run" dataevent so a parked-then-resolved run's
  // status updates here without reopening the overlay.
  const [receiptStatus, setReceiptStatus] = useState<string | null>(null)

  useEffect(() => {
    if (!card.ReceiptRunID) {
      setReceiptStatus(null)
      return
    }
    const refresh = () => {
      ExecutionService.GetRun(card.ReceiptRunID).then((detail) => setReceiptStatus(detail.status)).catch(() => setReceiptStatus(null))
    }
    refresh()
    return Events.On('mill-data-changed', (evt) => {
      if ((evt.data as { entity?: string })?.entity === 'run') refresh()
    })
  }, [card.ReceiptRunID])

  const updateNow = async () => {
    setUpdating(true)
    setError('')
    try {
      await AtlasService.UpdateNow(card.ID)
      onSaved()
    } catch (err) {
      setError(String(err))
    } finally {
      setUpdating(false)
    }
  }

  // Navigates by the card's PERSISTED RefreshWorkflowID, not the
  // possibly-edited-but-unsaved draft field state below -- the receipt
  // run id was produced by whatever workflow was actually configured
  // when that run started.
  const openRun = () => {
    if (card.ReceiptRunID && card.RefreshWorkflowID) requestOpenWorkflow(card.RefreshWorkflowID, card.ReceiptRunID)
  }

  const save = async () => {
    setSaving(true)
    setError('')
    try {
      await AtlasService.UpdateCard(card.ID, title, note, fields, source, card.MirrorPath, refreshWorkflowID)
      onSaved()
      onClose()
    } catch (err) {
      setError(String(err))
    } finally {
      setSaving(false)
    }
  }

  const addLink = async (toCardID: string, linkKindID: string) => {
    await AtlasService.CreateLink(card.ID, toCardID, linkKindID, '')
    onSaved()
  }
  const removeLink = async (linkID: string) => {
    await AtlasService.DeleteLink(linkID)
    onSaved()
  }

  // Blocked server-side (atlassvc.DeleteCard) while the card still has
  // children -- the resulting error surfaces through the same `error`
  // state a failed Save would, rather than a second error slot.
  const { requestDelete, dialog: confirmDialog } = useConfirmDelete<Card>({
    entityType: 'card',
    labelOf: (c) => c.Title,
    onConfirm: (c) => {
      AtlasService.DeleteCard(c.ID).then(() => { onSaved(); onClose() }).catch((err) => setError(String(err)))
    },
  })

  return (
    // Primer's Dialog only ever forwards its own special-cased
    // "data-component" prop onto the rendered element -- it destructures
    // every other prop by name with no rest-spread, so a plain
    // data-testid is silently dropped (StepDetailOverlay.tsx's own
    // data-component usage is this same constraint, not a stylistic
    // choice).
    <Dialog
      title={t('overlay.title', { title: card.Title })}
      onClose={onClose}
      width="min(1200px, calc(100vw - 64px))"
      height="auto"
      data-component="atlas-card-overlay"
    >
      <Stack direction="vertical" gap="normal">
        <AtlasKindChip kind={kind} size="large" />

        <FormControl>
          <FormControl.Label>{t('overlay.titleLabel')}</FormControl.Label>
          <TextInput value={title} data-testid="atlas-overlay-title" onChange={(e) => setTitle(e.target.value)} block />
        </FormControl>

        <FormControl>
          <FormControl.Label>{t('overlay.noteLabel')}</FormControl.Label>
          <Textarea value={note} data-testid="atlas-overlay-note" rows={3} block onChange={(e) => setNote(e.target.value)} />
        </FormControl>

        {kind && (kind.Fields ?? []).length > 0 ? (
          <AtlasFieldsForm fields={kind.Fields ?? []} values={fields} onChange={(key, value) => setFields((prev) => ({ ...prev, [key]: value }))} />
        ) : (
          <Text as="p" size="small" className={runbookStyles.muted}>{t('overlay.noFields')}</Text>
        )}

        <FormControl>
          <FormControl.Label>{t('overlay.sourceLabel')}</FormControl.Label>
          <TextInput value={source} data-testid="atlas-overlay-source" onChange={(e) => setSource(e.target.value)} block />
          {source && (
            <FormControl.Caption>
              <a href={source} data-wml-openURL={source} data-testid="atlas-overlay-source-link">{source}</a>
            </FormControl.Caption>
          )}
        </FormControl>

        {card.MirrorPath && (
          <Text as="p" size="small" className={runbookStyles.muted}>{t('overlay.mirrorPath', { path: card.MirrorPath })}</Text>
        )}
        <Text as="p" size="small" className={runbookStyles.muted}>
          {card.LastSyncedAt && formatUpdated(card.LastSyncedAt) ? t('overlay.lastSynced', { when: formatUpdated(card.LastSyncedAt) }) : t('overlay.neverSynced')}
        </Text>

        <FormControl>
          <FormControl.Label>{t('overlay.refreshWorkflowLabel')}</FormControl.Label>
          <Stack direction="horizontal" gap="condensed" align="center">
            <EntityRefField refKind="workflow" value={refreshWorkflowID} onChange={setRefreshWorkflowID} />
            {card.RefreshWorkflowID && (
              <Button
                leadingVisual={SyncIcon}
                size="small"
                variant="invisible"
                data-testid="atlas-overlay-update-now"
                disabled={updating}
                onClick={() => void updateNow()}
              >
                {updating ? t('overlay.updating') : t('overlay.updateNow')}
              </Button>
            )}
          </Stack>
        </FormControl>

        {card.ReceiptRunID && (
          <Text as="p" size="small" className={runbookStyles.muted}>
            {t('overlay.receiptRunID')}{' '}
            <PrimerLink as="button" type="button" data-testid="atlas-overlay-receipt-run" onClick={openRun}>
              {card.ReceiptRunID}
            </PrimerLink>
            {receiptStatus && (
              <>
                {' '}
                <StatusStamp variant={runStatusVariant(receiptStatus)} data-testid="atlas-overlay-receipt-status">{receiptStatus}</StatusStamp>
              </>
            )}
          </Text>
        )}

        <AtlasCardOverlayLinks card={card} allCards={allCards} links={links} linkKinds={linkKinds} onAdd={addLink} onRemove={removeLink} />

        {error && <Text as="p" size="small" className={runbookStyles.error}>{error}</Text>}
        <Stack direction="horizontal" gap="condensed">
          <Button variant="primary" size="small" data-testid="atlas-overlay-save" disabled={saving || !title.trim()} onClick={() => void save()}>
            {t('overlay.save')}
          </Button>
          <Button variant="danger" size="small" data-testid="atlas-overlay-delete" onClick={() => requestDelete(card)}>
            {t('overlay.delete')}
          </Button>
        </Stack>
      </Stack>
      {confirmDialog}
    </Dialog>
  )
}
