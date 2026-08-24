import { useCallback, useEffect, useRef, useState } from 'react'
import { ViewMode } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import type { Card, Note } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { AtlasService } from '../shared/bindings'
import { useUISignalStore } from '../shared/uiSignalStore'
import { refreshAtlas } from './atlasStore'
import { titleFromFilename, titleFromNoteText } from './atlasCreateHelpers'
import { freeChildPosition } from './atlasContainmentPlacement'
import { computeEnclosedBoundingBoxOrigin } from './atlasBoardBoxes'
import { cardTool, noteTool, areaTool, isLockableArmTool, type AtlasArmableTool, type AtlasCreationTool } from './atlasTools'

export interface AtlasPlacementPopoverState {
  mode: 'create' | 'promote' | 'area'
  anchorPos: { x: number; y: number }
  flowPos?: { x: number; y: number }
  noteID?: string
  // objectID (goal 0179/0180): the OTHER promote-mode source, mutually
  // exclusive with noteID -- submitPopover's 'promote' branch checks
  // whichever one is set.
  objectID?: string
  initialTitle?: string
  // The paste door's own note carry-through (goal 0081 slice A3,
  // LOCKED design §2b): clipboard text/HTML becomes the new card's own
  // Note field, invisibly -- the popover's fields stay Kind+Title only,
  // this never renders as a form control.
  initialNote?: string
  // Frame-scoped placement (goal 0081 slice A2's "Add card to X" doors,
  // both frame-interior and frame-chrome): the target frame's own id,
  // overriding the board's own container as the new card's parent.
  // freeChildPosition -- never flowPos -- supplies the real position
  // once this is set, since flowPos is only ever meaningful on the
  // board the click actually happened on.
  parentIDOverride?: string
  // Area mode's own enclosed membership (marker-box / select-then-
  // group, goal 0081 slice A2): every top-level card/note id the
  // gesture is about to reparent into the new container card.
  enclosedCardIDs?: string[]
  enclosedNoteIDs?: string[]
  // Slot-drag's own guided-create door (goal 0081 slice A4, LOCKED
  // design decision D1=B): a link-slot drag released on empty canvas
  // -- the kind is already fixed by the row that was dragged, so
  // submitPopover routes through the atomic CreateCardLinkedFrom
  // instead of a plain CreateCard.
  slotLinkFromCardID?: string
  slotLinkKindID?: string
  // "Add linked card…" card-menu door (goal 0081 slice A4): the
  // generic-kind counterpart -- AddLinkedCard resolves the relates-to
  // link kind AND the new card's parent server-side, so only the
  // source card's own id is carried here.
  addLinkedFromCardID?: string
}

// AtlasView's own downward creation requests -- the pane right-click
// menu's "Add card"/"Add note"/"Promote to card…" items (goal 0081
// slice A1) place/promote AT the click point directly, bypassing the
// armed-tool state entirely. Same token-carrying shape as
// shared/uiSignalStore.ts's atlasArmToolRequest, one level down (this
// one is AtlasView-local state, not a cross-bounded-context signal,
// since the pane ContextMenu's own item.run() closures are defined
// right there in AtlasView already). parentIDOverride (slice A2)
// carries a frame-menu's own "Add card to X"/"Add note here" target.
export interface AtlasPlacementRequest { tool: AtlasCreationTool; pos: { x: number; y: number }; parentIDOverride?: string; linkFromCardID?: string; token: number }
// noteID XOR objectID (goal 0179/0180's own Promote-to-card, mirroring
// PromoteNote's shape): the same popover, kind+title only, either
// source resolves to the identical submitPopover 'promote' branch.
export interface AtlasPromoteRequest { noteID?: string; objectID?: string; pos: { x: number; y: number }; token: number }
// Select-then-group (goal 0081 slice A2, LOCKED design §2): a
// multi-selection's own "Group into new area" menu item, requesting
// the SAME area-mode popover the marker-box drag opens.
export interface AtlasGroupRequest { cardIDs: string[]; noteIDs: string[]; pos: { x: number; y: number }; token: number }

// The full arm -> place -> confirm state machine behind the creation
// tray, right-click create, sticky notes, note promotion (goal 0081
// slice A1), and area creation (slice A2: draw-empty, marker-box, and
// select-then-group all funnel into the SAME 'area'-mode popover here)
// -- split out of AtlasBoard.tsx (architecture.md's 500-line
// convention) since this is the bulk of the new interaction surface.
// parentID is the board's OWN current container (AtlasView's viewedID,
// threaded down unchanged) -- the LOCKED design's "parent = where you
// are" rule for every canvas-foremost creation door.
export function useAtlasCreation({ parentID, allCards, kinds, notes, objects, readOnly, screenToFlowPosition, placementRequest, promoteRequest, groupRequest, cardBoxes, noteBoxes }: {
  parentID: string
  allCards: Card[]
  kinds: import('../../bindings/github.com/alicoding/mill/internal/domain/atlas/models').Kind[]
  notes: Note[]
  // Board objects (goal 0179/0180): read only for their own Promote
  // popover's initialTitle default -- everything else about them is
  // handled by useAtlasObjectMenu.ts/AtlasBoard.tsx directly.
  objects: import('../../bindings/github.com/alicoding/mill/internal/domain/atlas/models').BoardObject[]
  readOnly: boolean
  screenToFlowPosition: (p: { x: number; y: number }) => { x: number; y: number }
  placementRequest?: AtlasPlacementRequest | null
  promoteRequest?: AtlasPromoteRequest | null
  groupRequest?: AtlasGroupRequest | null
  // Every top-level card/note's own rendered flow-space box (freeMoves-
  // aware -- AtlasBoard.tsx's topLevelBoxes/noteBoxes), used ONLY to
  // anchor select-then-group's new container at its members' own
  // current position instead of the triggering click point.
  cardBoxes?: { id: string; x: number; y: number }[]
  noteBoxes?: { id: string; x: number; y: number }[]
}) {
  // armedTool + locked as ONE state (goal 0199 part D), not two --
  // "locked" only ever means anything relative to whichever tool is
  // CURRENTLY armed, so keeping them separate opens a window where one
  // updates without the other. Discrete tools disarm on their own
  // commit unless locked; continuous tools (pencil/eraser/laser) never
  // read `locked` at all and keep today's plain toggle-to-disarm
  // behaviour, unchanged in toggleArm below.
  const [arm, setArm] = useState<{ tool: AtlasArmableTool; locked: boolean } | null>(null)
  const armedTool = arm?.tool ?? null
  const locked = arm?.locked ?? false
  const [popover, setPopover] = useState<AtlasPlacementPopoverState | null>(null)
  const [draftNoteFlowPos, setDraftNoteFlowPos] = useState<{ x: number; y: number } | null>(null)
  const [draftNoteParentOverride, setDraftNoteParentOverride] = useState<string | null>(null)
  const [editingNoteID, setEditingNoteID] = useState<string | null>(null)
  // The freshly placed card whose title edits inline on its node
  // (goal 0144) -- the naming happens ON the object, never in a form.
  const [editingTitleCardID, setEditingTitleCardID] = useState<string | null>(null)
  // Read at commit/submit time only, never a useCallback dependency --
  // allCards is a fresh array reference on every store refresh, and
  // this hook's callbacks feed a builtNodes-adjacent useMemo elsewhere
  // (AtlasBoard.tsx's own header comment on the React #185 infinite-
  // loop regression this file already fixed once). Synced via effect,
  // not during render (useBoardFocus.ts's own latest-ref convention).
  const allCardsRef = useRef(allCards)
  const kindsRef = useRef(kinds)
  useEffect(() => {
    allCardsRef.current = allCards
    kindsRef.current = kinds
  }, [allCards])

  // Every function below is useCallback-wrapped and returned to the
  // caller, which feeds several of them (commitDraftNote,
  // onCancelEdit, onCommitEdit, ...) into a React Flow node's own
  // `data`, which in turn sits in a useMemo's dependency array
  // (atlasStickyNodes.ts, consumed by AtlasBoard.tsx). A plain
  // (non-memoized) function here would be a brand-new reference every
  // render, which -- because that useMemo's OWN output feeds a
  // useEffect calling setNodes, and setNodes triggers exactly the
  // re-render that recreates these functions -- becomes an infinite
  // render loop (confirmed live: React error #185, "Maximum update
  // depth exceeded"). useCallback keeps each reference stable across a
  // render that didn't actually change its own closed-over values.
  // Re-clicking the ALREADY-armed tray button: a continuous tool
  // disarms (unchanged). A lockable discrete tool locks first (the
  // Excalidraw convention for deliberate repetition) and disarms only
  // on a THIRD click -- re-arming fresh always clears any prior lock.
  const toggleArm = useCallback((tool: AtlasArmableTool) => {
    if (readOnly) return
    setArm((cur) => {
      if (!cur || cur.tool !== tool) return { tool, locked: false }
      if (isLockableArmTool(tool)) return cur.locked ? null : { tool, locked: true }
      return null
    })
  }, [readOnly])
  const armTool = useCallback((tool: AtlasArmableTool) => {
    if (!readOnly) setArm({ tool, locked: false })
  }, [readOnly])
  const disarm = useCallback(() => setArm(null), [])
  // A discrete tool's own one-shot commit (goal 0199): disarms unless
  // the user explicitly locked it for deliberate repetition.
  const disarmUnlessLocked = useCallback(() => {
    setArm((cur) => (cur?.locked ? cur : null))
  }, [])

  // A canvas click/drop while armed places at that point and DISARMS
  // (one placement per arming, the LOCKED design's own rule) --
  // explicitTool lets the right-click "Add card"/"Add note" pane menu
  // items place directly without going through the armed state at all.
  // None of Area/Pencil/Eraser/Laser/Shape has click-based placement:
  // each one's own drag gesture is handled entirely by its own hook
  // (useAtlasAreaDraw, useAtlasPencilDraw, useAtlasEraserDraw,
  // useAtlasLaserDraw, useAtlasShapeDraw -- all wired in AtlasBoard.tsx),
  // which either disarms itself (Area) or stays armed and never routes
  // through here at all (the other four) -- excluded regardless, so a
  // stray click while one of them is armed never falls through to the
  // note-draft branch below.
  const placeAt = useCallback((screenPos: { x: number; y: number }, explicitTool?: AtlasCreationTool, parentIDOverride?: string, linkFromCardID?: string) => {
    const tool = explicitTool ?? armedTool
    if (!tool || tool === 'area' || tool === 'pencil' || tool === 'eraser' || tool === 'laser' || tool === 'shape' || readOnly) return
    setArm(null)
    // "Add linked card…" (goal 0081 slice A4) lands beside the linking
    // card, at a free spot in ITS parent -- never at the menu's own
    // click point, which is only where the popover visually anchors.
    if (tool === 'card' && linkFromCardID) {
      const source = allCardsRef.current.find((c) => c.ID === linkFromCardID)
      const position = freeChildPosition(allCardsRef.current, source?.ParentID ?? parentID)
      setPopover({ mode: 'create', anchorPos: screenPos, flowPos: { x: position.X, y: position.Y }, addLinkedFromCardID: linkFromCardID })
      return
    }
    const flowPos = screenToFlowPosition(screenPos)
    if (tool === 'card') {
      // Instant placement (goal 0144): the click IS the creation --
      // last-used kind, "Untitled", inline title editor on the node.
      // The popover survives only for flows that carry richer intent
      // (promote, area, slot-linked, paste).
      const artifact = cardTool.commit({ kinds: kindsRef.current })
      const targetParentID = parentIDOverride ?? parentID
      const position = parentIDOverride ? freeChildPosition(allCardsRef.current, parentIDOverride) : { X: flowPos.x, Y: flowPos.y }
      void AtlasService.CreateCard(artifact.kindID, artifact.title, artifact.note, {}, targetParentID, position, ViewMode.$zero, '', '', '')
        .then((card) => {
          setEditingTitleCardID(card.ID)
          return refreshAtlas()
        })
        .catch(console.error)
    } else {
      setDraftNoteFlowPos(flowPos)
      setDraftNoteParentOverride(parentIDOverride ?? null)
    }
  }, [armedTool, readOnly, screenToFlowPosition, parentID])

  // Slot-drag's own guided-create door (goal 0081 slice A4, LOCKED
  // design §3): opens the SAME 'create' popover at the release point,
  // carrying the dragged row's own kind through to submitPopover.
  const openSlotLinkedCreate = useCallback((fromCardID: string, linkKindID: string, screenPos: { x: number; y: number }, flowPos: { x: number; y: number }) => {
    setPopover({ mode: 'create', anchorPos: screenPos, flowPos, slotLinkFromCardID: fromCardID, slotLinkKindID: linkKindID })
  }, [])

  const openPromote = useCallback((noteID: string, screenPos: { x: number; y: number }) => {
    const note = notes.find((n) => n.ID === noteID)
    if (!note) return
    setPopover({ mode: 'promote', anchorPos: screenPos, noteID, initialTitle: titleFromNoteText(note.Text) })
  }, [notes])

  // The board object's own promote door (goal 0179/0180's explicit,
  // one-way escape hatch out of board-local): same popover, title
  // defaults from the mirrored file's own name since an object carries
  // no text of its own to derive one from.
  const openPromoteObject = useCallback((objectID: string, screenPos: { x: number; y: number }) => {
    const object = objects.find((o) => o.ID === objectID)
    if (!object) return
    // Payload.title (useAtlasImageCreate.ts/useAtlasPencilCreate.ts's
    // own artifact.title, carried along purely for this moment) beats
    // re-deriving one from the mirror file's own randomized-suffix
    // filename; 'Untitled' matches cardTool's own instant-placement
    // default (atlasTools.ts) for the residual case of neither existing.
    const mirrorPath = object.Payload?.mirrorPath ?? ''
    const fallbackTitle = mirrorPath ? titleFromFilename(mirrorPath) : 'Untitled'
    setPopover({ mode: 'promote', anchorPos: screenPos, objectID, initialTitle: object.Payload?.title || fallbackTitle })
  }, [objects])

  // Paste text/HTML (goal 0081 slice A3, LOCKED design §2b): opens the
  // SAME 'create' popover, title = first line of the pasted text, note
  // = the full text (or converted Markdown, for the HTML branch --
  // AtlasBoard's own paste handler runs the conversion before calling
  // this). parentIDOverride carries the frame-at-point resolution the
  // paste handler already ran, matching every other canvas-foremost door.
  const openPasteText = useCallback((screenPos: { x: number; y: number }, text: string, parentIDOverride?: string) => {
    setPopover({ mode: 'create', anchorPos: screenPos, initialTitle: titleFromNoteText(text), initialNote: text, parentIDOverride })
  }, [])

  // The marker-box/select-group door (goal 0081 slice A2): opens the
  // SAME popover in 'area' mode, anchored at screenPos, with the
  // enclosed membership already resolved by the caller (useAtlasAreaDraw's
  // own enclosure test, or AtlasView's multi-selection).
  const openAreaPopover = useCallback((screenPos: { x: number; y: number }, flowPos: { x: number; y: number }, enclosedCardIDs: string[], enclosedNoteIDs: string[]) => {
    setPopover({ mode: 'area', anchorPos: screenPos, flowPos, enclosedCardIDs, enclosedNoteIDs })
  }, [])

  const cancelPopover = useCallback(() => setPopover(null), [])

  // The service calls below live OUTSIDE any setState updater on
  // purpose: updater functions must be pure -- React StrictMode
  // double-invokes them, which turned every confirm into TWO created
  // cards/notes (regression: duplicate creation under the dev build).
  // Reading `popover` from the closure is safe here; this callback's
  // identity changing when the popover opens/closes is bounded and
  // never feeds the sticky-node data path that caused the React #185
  // loop this file's other comments describe.
  // eslint-disable-next-line sonarjs/cognitive-complexity -- legacy complexity grandfathered at gate adoption; pay down when touched (goal 0109 burn-down)
  const submitPopover = useCallback((kindID: string, title: string) => {
    const pending = popover
    if (!pending) return
    setPopover(null)
    {
      if (pending.mode === 'create' && pending.slotLinkFromCardID && pending.slotLinkKindID) {
        // Slot-drag guided-create (goal 0081 slice A4, D1=B): atomic,
        // so the map never shows a card with a missing link or a link
        // to nothing.
        const position = pending.flowPos ? { X: pending.flowPos.x, Y: pending.flowPos.y } : null
        void AtlasService.CreateCardLinkedFrom(pending.slotLinkFromCardID, pending.slotLinkKindID, kindID, title, parentID, position)
          .then(() => refreshAtlas())
          .catch(console.error)
      } else if (pending.mode === 'create' && pending.addLinkedFromCardID) {
        // "Add linked card…" (goal 0081 slice A4): AddLinkedCard
        // resolves the generic relates-to kind and the new card's own
        // parent server-side.
        const position = pending.flowPos ? { X: pending.flowPos.x, Y: pending.flowPos.y } : null
        void AtlasService.AddLinkedCard(pending.addLinkedFromCardID, kindID, title, position)
          .then(() => refreshAtlas())
          .catch(console.error)
      } else if (pending.mode === 'create') {
        const artifact = cardTool.commit({ kinds: kindsRef.current, kindID, title, note: pending.initialNote })
        const targetParentID = pending.parentIDOverride ?? parentID
        const position = pending.parentIDOverride
          ? freeChildPosition(allCardsRef.current, pending.parentIDOverride)
          : (pending.flowPos ? { X: pending.flowPos.x, Y: pending.flowPos.y } : null)
        void AtlasService.CreateCard(artifact.kindID, artifact.title, artifact.note, {}, targetParentID, position, ViewMode.$zero, '', '', '')
          .then(() => refreshAtlas())
          .catch(console.error)
      } else if (pending.mode === 'promote' && pending.noteID) {
        void AtlasService.PromoteNote(pending.noteID, kindID, title)
          .then(() => refreshAtlas())
          .catch(console.error)
      } else if (pending.mode === 'promote' && pending.objectID) {
        void AtlasService.PromoteBoardObject(pending.objectID, kindID, title)
          .then(() => refreshAtlas())
          .catch(console.error)
      } else if (pending.mode === 'area') {
        const artifact = areaTool.commit({ kindID, title, enclosedCardIDs: pending.enclosedCardIDs ?? [], enclosedNoteIDs: pending.enclosedNoteIDs ?? [] })
        const position = pending.flowPos ? { X: pending.flowPos.x, Y: pending.flowPos.y } : null
        // An area drawn/grouped via a spatial gesture defaults its OWN
        // children to Canvas mode -- drag filing (and the Area tool
        // itself) is a Free-mode-only interaction, so an area that
        // opened into Shelves by default would make its own creator
        // immediately unable to keep filing cards into it after
        // drilling in.
        void AtlasService.CreateCard(artifact.kindID, artifact.title, '', {}, parentID, position, ViewMode.ViewModeCanvas, '', '', '')
          .then((created) => Promise.all([
            ...artifact.enclosedCardIDs.map((id) => AtlasService.MoveCard(id, created.ID)),
            ...artifact.enclosedNoteIDs.map((id) => AtlasService.MoveNote(id, created.ID)),
          ]))
          .then(() => refreshAtlas())
          .catch(console.error)
      }
    }
  }, [popover, parentID])

  const commitDraftNote = useCallback((text: string) => {
    const pos = draftNoteFlowPos
    const override = draftNoteParentOverride
    setDraftNoteFlowPos(null)
    setDraftNoteParentOverride(null)
    {
      // Empty text still creates: the placement itself is the capture
      // (a spatial placeholder typed into later); Escape is the cancel.
      if (pos) {
        const artifact = noteTool.commit({ text })
        const targetParentID = override ?? parentID
        const position = override ? freeChildPosition(allCardsRef.current, override) : { X: pos.x, Y: pos.y }
        void AtlasService.CreateNote(artifact.text, position, targetParentID)
          .then(() => refreshAtlas())
          .catch(console.error)
      }
    }
  }, [parentID, draftNoteFlowPos, draftNoteParentOverride])
  const cancelDraftNote = useCallback(() => {
    setDraftNoteFlowPos(null)
    setDraftNoteParentOverride(null)
  }, [])

  const commitCardTitle = useCallback((cardID: string, title: string) => {
    setEditingTitleCardID(null)
    const trimmed = title.trim()
    if (!trimmed) return
    const card = allCardsRef.current.find((c) => c.ID === cardID)
    if (!card) return
    void AtlasService.UpdateCard(cardID, trimmed, card.Note, card.Fields ?? {}, card.Source, card.MirrorPath, card.RefreshWorkflowID)
      .then(() => refreshAtlas())
      .catch(console.error)
  }, [])
  const cancelCardTitle = useCallback(() => setEditingTitleCardID(null), [])

  const enterNoteEdit = useCallback((noteID: string) => {
    if (!readOnly) setEditingNoteID(noteID)
  }, [readOnly])
  const cancelNoteEdit = useCallback(() => setEditingNoteID(null), [])
  const commitNoteEdit = useCallback((noteID: string, text: string) => {
    setEditingNoteID(null)
    const trimmed = text.trim()
    // An existing note's own text may never be blanked out by a stray
    // blur -- an empty commit on an ALREADY-persisted note is a no-op,
    // unlike the draft case above where it means "never created".
    if (!trimmed) return
    void AtlasService.UpdateNoteText(noteID, trimmed)
      .then(() => refreshAtlas())
      .catch(console.error)
  }, [])

  // Esc's own single entry point (AtlasBoard's window listener calls
  // this) -- cancels whichever transient state is currently open. Every
  // setter is a no-op when already null/false, so calling all of them
  // unconditionally is safe.
  const cancelAll = useCallback(() => {
    // Escape disarms even a LOCKED tool (goal 0199's own contract item
    // 4) -- unlike disarmUnlessLocked above, this never checks lock.
    setArm(null)
    setPopover(null)
    setDraftNoteFlowPos(null)
    setDraftNoteParentOverride(null)
    setEditingNoteID(null)
    setEditingTitleCardID(null)
  }, [])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cancelAll()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [cancelAll])

  // atlas.create.card/note/area's own bare C/N/A keypress
  // (shared/commands.ts, app/useKeymapDispatch.ts) -- always ARMS
  // (never toggles), matching the tray's own click-to-arm, distinct
  // from clicking an already-armed tool (which does toggle,
  // AtlasCreationTray.tsx).
  const armToolRequest = useUISignalStore((s) => s.atlasArmToolRequest)
  const lastArmToolToken = useRef(armToolRequest?.token)
  useEffect(() => {
    if (armToolRequest?.token === lastArmToolToken.current) return
    lastArmToolToken.current = armToolRequest?.token
    if (armToolRequest) armTool(armToolRequest.tool)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the request's own token, armTool/readOnly read at fire time
  }, [armToolRequest])

  const lastPlacementToken = useRef(placementRequest?.token)
  useEffect(() => {
    if (!placementRequest || placementRequest.token === lastPlacementToken.current) return
    lastPlacementToken.current = placementRequest.token
    placeAt(placementRequest.pos, placementRequest.tool, placementRequest.parentIDOverride, placementRequest.linkFromCardID)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the request's own token, same shape as every other one-shot signal in this file
  }, [placementRequest])

  const lastPromoteToken = useRef(promoteRequest?.token)
  useEffect(() => {
    if (!promoteRequest || promoteRequest.token === lastPromoteToken.current) return
    lastPromoteToken.current = promoteRequest.token
    if (promoteRequest.objectID) openPromoteObject(promoteRequest.objectID, promoteRequest.pos)
    else if (promoteRequest.noteID) openPromote(promoteRequest.noteID, promoteRequest.pos)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the request's own token
  }, [promoteRequest])

  // Select-then-group (goal 0081 slice A2): the new container lands at
  // the grouped members' own current bounding-box top-left, not the
  // triggering click point -- a member right-click or the selection
  // tray's bottom-center Group button both click far from where the
  // members actually render (regression: the tray path always landed
  // the new area at the bottom of the board). Falls back to the click
  // point only when no member box resolves (shouldn't happen for a
  // real 2+ selection, but keeps this door from silently no-op'ing).
  const lastGroupToken = useRef(groupRequest?.token)
  useEffect(() => {
    if (!groupRequest || groupRequest.token === lastGroupToken.current) return
    lastGroupToken.current = groupRequest.token
    const anchor = computeEnclosedBoundingBoxOrigin(groupRequest.cardIDs, groupRequest.noteIDs, cardBoxes ?? [], noteBoxes ?? [])
    openAreaPopover(groupRequest.pos, anchor ?? screenToFlowPosition(groupRequest.pos), groupRequest.cardIDs, groupRequest.noteIDs)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the request's own token
  }, [groupRequest])

  return {
    armedTool, locked, toggleArm, armTool, disarm, disarmUnlessLocked, placeAt,
    popover, cancelPopover, submitPopover, openPromote, openPromoteObject, openPasteText, openAreaPopover, openSlotLinkedCreate,
    draftNoteFlowPos, commitDraftNote, cancelDraftNote,
    editingNoteID, enterNoteEdit, cancelNoteEdit, commitNoteEdit,
    editingTitleCardID, commitCardTitle, cancelCardTitle,
    cancelAll,
  }
}

export type AtlasCreation = ReturnType<typeof useAtlasCreation>
