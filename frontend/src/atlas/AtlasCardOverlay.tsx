import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Events } from '@wailsio/runtime'
import { Dialog, Text } from '@primer/react'
import type { Card, Kind, Link, LinkKind } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import type { TombstoneResult } from '../../bindings/github.com/alicoding/mill/internal/services/atlassvc/models'
import { AtlasService, ExecutionService } from '../shared/bindings'
import { useAppStore } from '../shared/store'
import { atlasCardShareActions } from './atlasCardShare'
import { useCardPageNav } from './atlasCardPageNav'
import { AtlasCardPageHeader } from './AtlasCardPageHeader'
import { AtlasCardPageFields } from './AtlasCardPageFields'
import { AtlasCardPageContents } from './AtlasCardPageContents'
import { AtlasCardPageMetaRail } from './AtlasCardPageMetaRail'
import { AtlasSlotRows } from './AtlasSlotRows'
import { useAtlasCardPageFileDrop } from './useAtlasCardPageFileDrop'
import { FILE_DROP_CONTEXT_CARD_PAGE } from './atlasFileDropShared'
import runbookStyles from '../shared/ListCard.module.css'
import styles from './AtlasCardPage.module.css'

type CardFieldPatch = Partial<{
  title: string
  note: string
  fields: Record<string, string>
  source: string
  mirrorPath: string
}>

// The "page" surface (docs/goals/0072 slice C, evolving goal 0061's
// full-screen overlay; read-is-edit + chip navigation added by goal
// 0081 slice A5, LOCKED design §5b): the one deliberate off-board step
// in the one-map model -- close puts the board back exactly as it was,
// camera untouched. Built on Primer's own Dialog (Esc/backdrop-click/
// focus-trap stay the kit's behavior, per frontend.md) with a custom
// header/body via renderHeader/renderBody rather than Dialog's own
// default title bar, so the ratified page anatomy can render exactly
// as specified.
//
// Chip navigation (LOCKED design §5b "chips navigate, and you can come
// back"): useCardPageNav owns a session-local stack of previously
// shown card IDs; `card` below is always the card this instance was
// OPENED with (its ID seeds the stack and never changes), while
// `displayedCard` is whichever card the stack currently points at --
// every field/link/meta render off displayedCard, never `card`
// directly, once navigation exists.
//
// Every field saves independently on blur/change (no edit mode, no
// Save button) through UpdateCard, which is a WHOLE-card write --
// `persist` below always sends the full current bundle, patched with
// only the one field that just fired, read from local state directly
// rather than round-tripped through a setState call in the same
// handler (testing.md's stale-setState trap). ParentID/Position/
// ViewMode never change here (MoveCard/SetPosition/SetViewMode own
// those, driven by drag/drill actions elsewhere).
export function AtlasCardOverlay({ card, kinds, allCards, links, linkKinds, onClose, onSaved, onDeleted, onOpenGroupEntry }: {
  card: Card
  kinds: Kind[]
  allCards: Card[]
  links: Link[]
  linkKinds: LinkKind[]
  onClose: () => void
  onSaved: () => void
  onDeleted: (result: TombstoneResult) => void
  onOpenGroupEntry: (target: Card) => void
}) {
  const { t } = useTranslation('atlas')
  const requestOpenWorkflow = useAppStore((s) => s.requestOpenWorkflow)

  const nav = useCardPageNav(card.ID)
  const displayedCard = allCards.find((c) => c.ID === nav.currentID) ?? card
  const kind = kinds.find((k) => k.ID === displayedCard.KindID)
  const previousCard = nav.previousID ? (allCards.find((c) => c.ID === nav.previousID) ?? null) : null

  const [title, setTitle] = useState(displayedCard.Title)
  const [note, setNote] = useState(displayedCard.Note)
  const [fields, setFields] = useState<Record<string, string>>((displayedCard.Fields ?? {}) as Record<string, string>)
  const [source, setSource] = useState(displayedCard.Source)
  const [mirrorPath, setMirrorPath] = useState(displayedCard.MirrorPath)
  const [actionWorkflowIDs, setActionWorkflowIDs] = useState<string[]>(displayedCard.ActionWorkflowIDs ?? [])
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [savedTick, setSavedTick] = useState(false)
  const savedTickTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [updating, setUpdating] = useState(false)
  const [receiptStatus, setReceiptStatus] = useState<string | null>(null)
  const [includeAttachments, setIncludeAttachments] = useState(false)
  const [copied, setCopied] = useState(false)
  const [shareError, setShareError] = useState('')
  const shareActions = atlasCardShareActions(displayedCard, (message) => setShareError(message))
  // D5 (goal 0081 slice A3): a file dropped while this page is open
  // becomes a linked sibling of whichever card is CURRENTLY shown,
  // never mutating it -- see the hook's own header comment.
  useAtlasCardPageFileDrop({ card: displayedCard, allCards, onSaved, onError: setShareError })

  // Reset the draft bundle whenever navigation lands on a DIFFERENT
  // card: each card's page shows ITS OWN values, never a value carried
  // over from wherever the chip trail started. Never fires on a
  // refetch of the SAME card (onSaved's refreshAtlas), which would
  // otherwise clobber an in-progress edit with the just-saved value.
  useEffect(() => {
    setTitle(displayedCard.Title)
    setNote(displayedCard.Note)
    setFields((displayedCard.Fields ?? {}) as Record<string, string>)
    setSource(displayedCard.Source)
    setMirrorPath(displayedCard.MirrorPath)
    setActionWorkflowIDs(displayedCard.ActionWorkflowIDs ?? [])
    setErrors({})
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the card identity alone, deliberately
  }, [displayedCard.ID])

  const copyContext = async () => {
    await shareActions.copyAsContext(includeAttachments)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  useEffect(() => {
    if (!displayedCard.ReceiptRunID) {
      setReceiptStatus(null)
      return
    }
    const refresh = () => {
      ExecutionService.GetRun(displayedCard.ReceiptRunID).then((detail) => setReceiptStatus(detail.status)).catch(() => setReceiptStatus(null))
    }
    refresh()
    return Events.On('mill-data-changed', (evt) => {
      if ((evt.data as { entity?: string })?.entity === 'run') refresh()
    })
  }, [displayedCard.ReceiptRunID])

  const updateNow = () => {
    setUpdating(true)
    setShareError('')
    AtlasService.UpdateNow(displayedCard.ID)
      .then(onSaved)
      .catch((err) => setShareError(String(err)))
      .finally(() => setUpdating(false))
  }

  // Navigates by the card's PERSISTED RefreshWorkflowID, not a
  // possibly-edited-but-not-yet-saved draft -- the receipt run id was
  // produced by whatever workflow was actually configured when that
  // run started.
  const openRun = () => {
    if (displayedCard.ReceiptRunID && displayedCard.RefreshWorkflowID) requestOpenWorkflow(displayedCard.RefreshWorkflowID, displayedCard.ReceiptRunID)
  }

  const showSavedTick = () => {
    setSavedTick(true)
    if (savedTickTimeout.current) clearTimeout(savedTickTimeout.current)
    savedTickTimeout.current = setTimeout(() => setSavedTick(false), 1500)
  }

  const persist = async (patch: CardFieldPatch, errorKey: string) => {
    try {
      await AtlasService.UpdateCard(
        displayedCard.ID,
        patch.title ?? title,
        patch.note ?? note,
        patch.fields ?? fields,
        patch.source ?? source,
        patch.mirrorPath ?? mirrorPath,
        '',
      )
      setErrors((prev) => {
        if (!(errorKey in prev)) return prev
        const next = { ...prev }
        delete next[errorKey]
        return next
      })
      showSavedTick()
      onSaved()
    } catch {
      setErrors((prev) => ({ ...prev, [errorKey]: t('page.saveError') }))
    }
  }

  const commitTitle = () => void persist({ title }, 'title')
  const commitNote = () => void persist({ note }, 'note')
  const commitSource = () => void persist({ source }, 'source')
  const commitMirrorPath = () => void persist({ mirrorPath }, 'mirrorPath')
  const commitField = (key: string, value: string) => {
    const nextFields = { ...fields, [key]: value }
    setFields(nextFields)
    void persist({ fields: nextFields }, `field:${key}`)
  }
  // Actions persist through their own bound method (not UpdateCard) --
  // computed into a local and passed directly, per testing.md's
  // stale-setState rule.
  const commitActions = (next: string[]) => {
    setActionWorkflowIDs(next)
    AtlasService.SetCardActions(displayedCard.ID, next)
      .then(() => { showSavedTick(); onSaved() })
      .catch(() => setErrors((prev) => ({ ...prev, actions: t('page.saveError') })))
  }

  const fieldErrors: Record<string, string> = {}
  for (const [key, message] of Object.entries(errors)) {
    if (key.startsWith('field:')) fieldErrors[key.slice('field:'.length)] = message
  }

  const addLink = async (linkKindID: string, toCardID: string) => {
    await AtlasService.CreateLink(displayedCard.ID, toCardID, linkKindID, '')
    onSaved()
  }
  const removeLink = async (linkID: string) => {
    await AtlasService.DeleteLink(linkID)
    onSaved()
  }

  // Delete now lives ONLY behind the header's kebab menu (rider (a),
  // superseding the old edit-section's bare Delete button), instant --
  // no confirm (goal 0093's quick-delete-with-undo guard). onDeleted
  // reports the TombstoneResult up to AtlasView's shared undo toast.
  const deleteCard = () => {
    AtlasService.DeleteCard(displayedCard.ID)
      .then((result) => { onDeleted(result); onSaved(); onClose() })
      .catch((err) => setShareError(String(err)))
  }

  return (
    // Primer's Dialog only ever forwards its own special-cased
    // "data-component" prop onto the rendered element -- it
    // destructures every other prop by name with no rest-spread, so a
    // plain data-testid is silently dropped (StepDetailOverlay.tsx's
    // own data-component usage is this same constraint, not a
    // stylistic choice).
    <Dialog
      title={t('overlay.title', { title: displayedCard.Title })}
      onClose={onClose}
      width="min(1200px, calc(100vw - 64px))"
      height="auto"
      data-component="atlas-card-overlay"
      renderHeader={({ dialogLabelId }) => (
        <AtlasCardPageHeader
          card={displayedCard}
          kind={kind}
          dialogLabelId={dialogLabelId}
          onClose={onClose}
          titleValue={title}
          titleError={errors.title ?? ''}
          onTitleChange={setTitle}
          onTitleCommit={commitTitle}
          backTitle={previousCard?.Title ?? null}
          onBack={nav.back}
          savedTick={savedTick}
          showMirrorMenuItems={Boolean(displayedCard.MirrorPath)}
          onOpenFile={() => void AtlasService.OpenCardMirror(displayedCard.ID).catch((err) => setShareError(String(err)))}
          onRevealFile={() => void shareActions.revealFile()}
          onDelete={deleteCard}
        />
      )}
      renderBody={() => (
        <div className={styles.body} data-file-drop-target data-file-drop-context={FILE_DROP_CONTEXT_CARD_PAGE}>
          <div>
            <AtlasCardPageFields
              kind={kind}
              note={note} noteError={errors.note ?? ''} onNoteChange={setNote} onNoteCommit={commitNote}
              fields={fields} fieldErrors={fieldErrors}
              onFieldsChange={(key, value) => setFields((prev) => ({ ...prev, [key]: value }))}
              onFieldsCommit={commitField}
              source={source} sourceError={errors.source ?? ''} onSourceChange={setSource} onSourceCommit={commitSource}
              mirrorPath={mirrorPath} mirrorPathError={errors.mirrorPath ?? ''} onMirrorPathChange={setMirrorPath} onMirrorPathCommit={commitMirrorPath}
              cardID={displayedCard.ID} actionWorkflowIDs={actionWorkflowIDs}
              onActionsChanged={commitActions}
            />
            <AtlasSlotRows
              card={displayedCard}
              allCards={allCards}
              links={links}
              linkKinds={linkKinds}
              variant="page"
              onChipClick={nav.navigate}
              onRemoveLink={(linkID) => void removeLink(linkID)}
              onAddLink={(linkKindID, toCardID) => void addLink(linkKindID, toCardID)}
            />
            <AtlasCardPageContents card={displayedCard} allCards={allCards} kinds={kinds} onOpenGroupEntry={onOpenGroupEntry} onChildClick={nav.navigate} />
            {shareError && <Text as="p" size="small" className={runbookStyles.error} data-testid="atlas-page-share-error">{shareError}</Text>}
          </div>
          <AtlasCardPageMetaRail
            card={displayedCard}
            updating={updating}
            onUpdateNow={updateNow}
            receiptStatus={receiptStatus}
            onOpenRun={openRun}
            includeAttachments={includeAttachments}
            onIncludeAttachmentsChange={setIncludeAttachments}
            copied={copied}
            onCopyContext={() => void copyContext()}
            onCopyLink={() => void shareActions.copyCloudLink()}
          />
        </div>
      )}
    />
  )
}
