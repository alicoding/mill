import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Events } from '@wailsio/runtime'
import { Dialog, Text } from '@primer/react'
import type { Card, Kind, Link, LinkKind } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import type { TombstoneResult } from '../../bindings/github.com/alicoding/mill/internal/services/atlassvc/models'
import { AtlasService, ExecutionService } from '../shared/bindings'
import { useAppStore } from '../shared/store'
import { useUISignalStore } from '../shared/uiSignalStore'
import { CopyDiagnosisButton } from '../shared/CopyDiagnosisButton'
import { ContextMenu } from '../shared/ContextMenu'
import type { ContextMenuState } from '../shared/ContextMenu'
import { atlasCardShareActions } from './atlasCardShare'
import { useCardPageNav } from './atlasCardPageNav'
import { AtlasCardPageHeader } from './AtlasCardPageHeader'
import { AtlasCardPropertyStrip } from './AtlasCardPropertyStrip'
import { AtlasCardPageFields } from './AtlasCardPageFields'
import { AtlasCardPageContents } from './AtlasCardPageContents'
import { AtlasCardPageMetaRail } from './AtlasCardPageMetaRail'
import { AtlasSlotRows } from './AtlasSlotRows'
import { useAtlasCardPageFileDrop } from './useAtlasCardPageFileDrop'
import { FILE_DROP_CONTEXT_CARD_PAGE } from './atlasFileDropShared'
import { buildExportMenuChoice, runCardExport } from './atlasCardExportMenu'
import { atlasSelectionContext } from '../shared/atlasSelectionStore'
import type { UnitExporter } from './unitRegistry'
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
export function AtlasCardOverlay({ card, kinds, allCards, links, linkKinds, onClose, onSaved, onDeleted, onOpenGroupEntry, guardDelete }: {
  card: Card
  kinds: Kind[]
  allCards: Card[]
  links: Link[]
  linkKinds: LinkKind[]
  onClose: () => void
  onSaved: () => void
  onDeleted: (result: TombstoneResult) => void
  onOpenGroupEntry: (target: Card) => void
  // The container-delete gate (goal 0149 gap 3).
  guardDelete: (cardIDs: string[], noteIDs: string[], exec: () => void) => void
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
  const [copiedAI, setCopiedAI] = useState(false)
  const [shareError, setShareError] = useState('')
  const shareActions = atlasCardShareActions(displayedCard, (message) => setShareError(message))
  // D5 (goal 0081 slice A3): a file dropped while this page is open
  // becomes a linked sibling of whichever card is CURRENTLY shown,
  // never mutating it -- see the hook's own header comment.
  useAtlasCardPageFileDrop({ card: displayedCard, allCards, onSaved, onError: setShareError })

  // Export-as (ADR-0043 §3, goal 0133 slice E1): the format submenu
  // opens through the SAME shared/ContextMenu.tsx component the card's
  // own right-click menu uses (useAtlasLinkMenus.tsx) rather than a
  // second flyout mechanism -- reuses this page's existing error slot
  // (shareError) so a failed export reports through the identical
  // copyable-diagnosis surface every other page action already does.
  const [exportMenu, setExportMenu] = useState<ContextMenuState | null>(null)
  const onExportDownload = (exporter: UnitExporter) => void runCardExport(displayedCard, exporter, setShareError)
  const onExportOpenFormats = (exporters: UnitExporter[], pos: { x: number; y: number }) => setExportMenu({
    x: pos.x,
    y: pos.y,
    items: exporters.map((exp) => ({ id: `export-${exp.format}`, commandId: 'atlas.card.exportAs', ctx: atlasSelectionContext({ cards: [displayedCard.ID], notes: [], objects: [], links: [] }, { format: exp.format, pos }) })),
  })

  // atlas.card.exportAs (command palette, DoR item 6): the same choice
  // the header's kebab menu computes, fired for whichever card this
  // instance currently displays -- a harmless no-op if nothing is
  // exportable. No live click position exists from the palette, so a
  // multi-format result opens near the header's own kebab menu.
  const atlasCardExportAsRequest = useUISignalStore((s) => s.atlasCardExportAsRequest)
  const lastExportAsRequest = useRef(atlasCardExportAsRequest)
  useEffect(() => {
    if (atlasCardExportAsRequest === lastExportAsRequest.current) return
    lastExportAsRequest.current = atlasCardExportAsRequest
    buildExportMenuChoice({
      card: displayedCard,
      t,
      onDownload: onExportDownload,
      onOpenFormats: (exporters) => onExportOpenFormats(exporters, { x: window.innerWidth - 280, y: 96 }),
    })?.run()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the signal tick alone; displayedCard/t are read at fire time
  }, [atlasCardExportAsRequest])

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

  const copyForAI = async () => {
    await shareActions.copyForAI()
    setCopiedAI(true)
    setTimeout(() => setCopiedAI(false), 1500)
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
      const sentFields = patch.fields ?? fields
      const saved = await AtlasService.UpdateCard(
        displayedCard.ID,
        patch.title ?? title,
        patch.note ?? note,
        sentFields,
        patch.source ?? source,
        patch.mirrorPath ?? mirrorPath,
        '',
      )
      // Adopt server-COMPUTED field keys back into local state -- a
      // StampOnChange field (a sign-off's verifiedAt) is written by the
      // server, so it exists only in this response. Every save sends the
      // whole Fields map, so without this the next save writes the map
      // back WITHOUT the stamp and silently erases it. Only keys absent
      // from what was just sent are adopted: an in-flight edit to any
      // other field can never be clobbered by its own save's response,
      // which is the same protection the same-card refetch guard above
      // exists to provide.
      const savedFields = (saved?.Fields ?? {}) as Record<string, string>
      const computed = Object.entries(savedFields).filter(([key]) => !(key in sentFields))
      if (computed.length > 0) setFields((prev) => ({ ...prev, ...Object.fromEntries(computed) }))
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
  // Takes the authoritative current text directly from
  // MarkdownNoteField's own onCommit (its own comment has the debounce
  // race this closes) -- `note` state (kept for the field's controlled
  // `value` prop) can lag behind it by one Milkdown update cycle.
  const commitNote = (text: string) => void persist({ note: text }, 'note')
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
  const deleteCard = () => guardDelete([displayedCard.ID], [], () => {
    AtlasService.DeleteCard(displayedCard.ID)
      .then((result) => { onDeleted(result); onSaved(); onClose() })
      .catch((err) => setShareError(String(err)))
  })

  return (
    // Primer's Dialog only ever forwards its own special-cased
    // "data-component" prop onto the rendered element -- it
    // destructures every other prop by name with no rest-spread, so a
    // plain data-testid is silently dropped (StepDetailOverlay.tsx's
    // own data-component usage is this same constraint, not a
    // stylistic choice). The export-format ContextMenu is a sibling,
    // not nested inside Dialog's own tree -- shared/ContextMenu.tsx
    // renders through AnchoredOverlay's own portal regardless of where
    // it's mounted.
    <>
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
          onExportDownload={onExportDownload}
          onExportOpenFormats={onExportOpenFormats}
          onDelete={deleteCard}
        />
      )}
      renderBody={() => (
        // Own Escape handler, not just Dialog's built-in one:
        // ProseMirror (the note field's own Milkdown editor, goal 0244
        // S3) calls preventDefault() on every Escape keydown by
        // construction, and Dialog's own close-on-Escape skips a
        // defaultPrevented event -- so with focus inside the note
        // field, Escape would otherwise silently do nothing (see
        // AtlasNoteOverlay.tsx's identical fix for the full finding).
        <div
          className={styles.body}
          data-file-drop-target
          data-file-drop-context={FILE_DROP_CONTEXT_CARD_PAGE}
          onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }}
        >
          <div>
            <AtlasCardPropertyStrip
              card={displayedCard}
              kind={kind}
              fields={fields}
              onFieldsChange={(key, value) => setFields((prev) => ({ ...prev, [key]: value }))}
              onFieldsCommit={commitField}
            />
            <AtlasCardPageFields
              key={displayedCard.ID}
              kind={kind}
              note={note} noteError={errors.note ?? ''} onNoteChange={setNote} onNoteCommit={commitNote}
              fields={fields} fieldErrors={fieldErrors}
              onFieldsChange={(key, value) => setFields((prev) => ({ ...prev, [key]: value }))}
              onFieldsCommit={commitField}
              source={source} sourceError={errors.source ?? ''} onSourceChange={setSource} onSourceCommit={commitSource}
              mirrorPath={mirrorPath} mirrorPathError={errors.mirrorPath ?? ''} onMirrorPathChange={setMirrorPath} onMirrorPathCommit={commitMirrorPath}
              cardID={displayedCard.ID} actionWorkflowIDs={actionWorkflowIDs}
              onActionsChanged={commitActions}
              cardRefCandidates={(field) => allCards.filter((c) => c.ID !== displayedCard.ID && (!field.RefKind || c.KindID === field.RefKind)).map((c) => ({ id: c.ID, title: c.Title }))}
            />
            <AtlasSlotRows
              card={displayedCard}
              allCards={allCards}
              links={links}
              linkKinds={linkKinds}
              onChipClick={nav.navigate}
              onRemoveLink={(linkID) => void removeLink(linkID)}
              onAddLink={(linkKindID, toCardID) => void addLink(linkKindID, toCardID)}
            />
            <AtlasCardPageContents card={displayedCard} allCards={allCards} kinds={kinds} onOpenGroupEntry={onOpenGroupEntry} onChildClick={nav.navigate} />
            {shareError && (
              <span className={styles.shareErrorRow}>
                <Text as="p" size="small" className={runbookStyles.error} data-testid="atlas-page-share-error">{shareError}</Text>
                <CopyDiagnosisButton error={shareError} context={{ Card: displayedCard.Title }} testId="atlas-page-share-error-copy-diagnosis" />
              </span>
            )}
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
            copiedAI={copiedAI}
            onCopyForAI={() => void copyForAI()}
            onCopyLink={() => void shareActions.copyCloudLink()}
          />
        </div>
      )}
    />
    <ContextMenu state={exportMenu} onClose={() => setExportMenu(null)} />
    </>
  )
}
