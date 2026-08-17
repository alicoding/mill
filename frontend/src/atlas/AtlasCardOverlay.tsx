import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Events } from '@wailsio/runtime'
import { Dialog } from '@primer/react'
import type { Card, Kind, Link, LinkKind } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { AtlasService, ExecutionService } from '../shared/bindings'
import { useAppStore } from '../shared/store'
import { atlasCardShareActions } from './atlasCardShare'
import { useConfirmDelete } from '../shared/useConfirmDelete'
import { AtlasCardPageHeader } from './AtlasCardPageHeader'
import { AtlasCardPageContents } from './AtlasCardPageContents'
import { AtlasCardPageEditSection } from './AtlasCardPageEditSection'
import { AtlasCardPageMetaRail } from './AtlasCardPageMetaRail'
import { useAtlasCardPageFileDrop } from './useAtlasCardPageFileDrop'
import { FILE_DROP_CONTEXT_CARD_PAGE } from './atlasFileDropShared'
import styles from './AtlasCardPage.module.css'

// The "page" surface (docs/goals/0072 slice C, evolving goal 0061's
// full-screen overlay): the one deliberate off-board step in the
// one-map model -- close puts the board back exactly as it was, camera
// untouched. Built on Primer's own Dialog (Esc/backdrop-click/focus-
// trap stay the kit's behavior, per frontend.md) with a custom header/
// body via renderHeader/renderBody rather than Dialog's own default
// title bar, so the ratified page anatomy (kind glyph, file tag, a
// two-column Contents/meta-rail grid) can render exactly as specified.
// Save persists via UpdateCard; ParentID/Position/ViewMode never
// change here (MoveCard/SetPosition/SetViewMode own those, driven by
// drag/drill actions elsewhere).
export function AtlasCardOverlay({ card, kind, kinds, allCards, links, linkKinds, onClose, onSaved, onOpenGroupEntry }: {
  card: Card
  kind: Kind | undefined
  kinds: Kind[]
  allCards: Card[]
  links: Link[]
  linkKinds: LinkKind[]
  onClose: () => void
  onSaved: () => void
  onOpenGroupEntry: (target: Card) => void
}) {
  const { t } = useTranslation('atlas')
  const requestOpenWorkflow = useAppStore((s) => s.requestOpenWorkflow)
  const [title, setTitle] = useState(card.Title)
  const [note, setNote] = useState(card.Note)
  const [fields, setFields] = useState<Record<string, string>>((card.Fields ?? {}) as Record<string, string>)
  const [source, setSource] = useState(card.Source)
  const [mirrorPath, setMirrorPath] = useState(card.MirrorPath)
  const [refreshWorkflowID, setRefreshWorkflowID] = useState(card.RefreshWorkflowID)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [updating, setUpdating] = useState(false)
  // Receipt provenance (goal 0061 slice C, ADR-0038 decision 4): the
  // run's live status, fetched whenever card.ReceiptRunID changes and
  // refreshed on every "run" dataevent so a parked-then-resolved run's
  // status updates here without reopening the page.
  const [receiptStatus, setReceiptStatus] = useState<string | null>(null)
  // The meta rail's share row keeps its own with/without-attachments
  // toggle (goal 0063).
  const [includeAttachments, setIncludeAttachments] = useState(false)
  const [copied, setCopied] = useState(false)
  const shareActions = atlasCardShareActions(card, (message) => setError(message))
  // D5 (goal 0081 slice A3): a file dropped while this page is open
  // becomes a linked sibling, never mutating this card -- see the
  // hook's own header comment.
  useAtlasCardPageFileDrop({ card, allCards, onSaved, onError: setError })
  const copyContext = async () => {
    await shareActions.copyAsContext(includeAttachments)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

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

  const updateNow = () => {
    setUpdating(true)
    setError('')
    AtlasService.UpdateNow(card.ID)
      .then(onSaved)
      .catch((err) => setError(String(err)))
      .finally(() => setUpdating(false))
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
      await AtlasService.UpdateCard(card.ID, title, note, fields, source, mirrorPath, refreshWorkflowID)
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
    <>
    {/* Primer's Dialog only ever forwards its own special-cased
        "data-component" prop onto the rendered element -- it
        destructures every other prop by name with no rest-spread, so a
        plain data-testid is silently dropped (StepDetailOverlay.tsx's
        own data-component usage is this same constraint, not a
        stylistic choice). */}
    <Dialog
      title={t('overlay.title', { title: card.Title })}
      onClose={onClose}
      width="min(1200px, calc(100vw - 64px))"
      height="auto"
      data-component="atlas-card-overlay"
      renderHeader={({ dialogLabelId }) => (
        <AtlasCardPageHeader card={card} kind={kind} dialogLabelId={dialogLabelId} onClose={onClose} />
      )}
      renderBody={() => (
        <div className={styles.body} data-file-drop-target data-file-drop-context={FILE_DROP_CONTEXT_CARD_PAGE}>
          <div>
            <AtlasCardPageContents card={card} allCards={allCards} kinds={kinds} links={links} linkKinds={linkKinds} onOpenGroupEntry={onOpenGroupEntry} />
            <AtlasCardPageEditSection
              card={card}
              kind={kind}
              allCards={allCards}
              links={links}
              linkKinds={linkKinds}
              title={title}
              note={note}
              fields={fields}
              source={source}
              mirrorPath={mirrorPath}
              refreshWorkflowID={refreshWorkflowID}
              onTitleChange={setTitle}
              onNoteChange={setNote}
              onFieldsChange={(key, value) => setFields((prev) => ({ ...prev, [key]: value }))}
              onSourceChange={setSource}
              onMirrorPathChange={setMirrorPath}
              onRefreshWorkflowChange={setRefreshWorkflowID}
              onAddLink={addLink}
              onRemoveLink={removeLink}
              saving={saving}
              error={error}
              onSave={() => void save()}
              onDelete={() => requestDelete(card)}
            />
          </div>
          <AtlasCardPageMetaRail
            card={card}
            updating={updating}
            onUpdateNow={updateNow}
            receiptStatus={receiptStatus}
            onOpenRun={openRun}
            includeAttachments={includeAttachments}
            onIncludeAttachmentsChange={setIncludeAttachments}
            copied={copied}
            onCopyContext={() => void copyContext()}
            onCopyLink={() => void shareActions.copyCloudLink()}
            onRevealFile={() => void shareActions.revealFile()}
          />
        </div>
      )}
    />
    {confirmDialog}
    </>
  )
}
