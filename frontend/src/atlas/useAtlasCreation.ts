import { useCallback, useEffect, useRef, useState } from 'react'
import { ViewMode } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import type { Card, Note } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { AtlasService } from '../shared/bindings'
import { useUISignalStore } from '../shared/uiSignalStore'
import { refreshAtlas } from './atlasStore'
import { titleFromNoteText } from './atlasCreateHelpers'
import { freeChildPosition } from './atlasContainmentPlacement'
import type { AtlasCreationTool } from './AtlasCreationTray'

export interface AtlasPlacementPopoverState {
  mode: 'create' | 'promote' | 'area'
  anchorPos: { x: number; y: number }
  flowPos?: { x: number; y: number }
  noteID?: string
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
export interface AtlasPromoteRequest { noteID: string; pos: { x: number; y: number }; token: number }
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
export function useAtlasCreation({ parentID, allCards, notes, readOnly, screenToFlowPosition, placementRequest, promoteRequest, groupRequest }: {
  parentID: string
  allCards: Card[]
  notes: Note[]
  readOnly: boolean
  screenToFlowPosition: (p: { x: number; y: number }) => { x: number; y: number }
  placementRequest?: AtlasPlacementRequest | null
  promoteRequest?: AtlasPromoteRequest | null
  groupRequest?: AtlasGroupRequest | null
}) {
  const [armedTool, setArmedTool] = useState<AtlasCreationTool | null>(null)
  const [popover, setPopover] = useState<AtlasPlacementPopoverState | null>(null)
  const [draftNoteFlowPos, setDraftNoteFlowPos] = useState<{ x: number; y: number } | null>(null)
  const [draftNoteParentOverride, setDraftNoteParentOverride] = useState<string | null>(null)
  const [editingNoteID, setEditingNoteID] = useState<string | null>(null)
  // Read at commit/submit time only, never a useCallback dependency --
  // allCards is a fresh array reference on every store refresh, and
  // this hook's callbacks feed a builtNodes-adjacent useMemo elsewhere
  // (AtlasBoard.tsx's own header comment on the React #185 infinite-
  // loop regression this file already fixed once). Synced via effect,
  // not during render (useBoardFocus.ts's own latest-ref convention).
  const allCardsRef = useRef(allCards)
  useEffect(() => {
    allCardsRef.current = allCards
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
  const toggleArm = useCallback((tool: AtlasCreationTool) => {
    if (readOnly) return
    setArmedTool((cur) => (cur === tool ? null : tool))
  }, [readOnly])
  const armTool = useCallback((tool: AtlasCreationTool) => {
    if (!readOnly) setArmedTool(tool)
  }, [readOnly])
  const disarm = useCallback(() => setArmedTool(null), [])

  // A canvas click/drop while armed places at that point and DISARMS
  // (one placement per arming, the LOCKED design's own rule) --
  // explicitTool lets the right-click "Add card"/"Add note" pane menu
  // items place directly without going through the armed state at all.
  // Area has no click-based placement (its own drag-drawn rect is
  // handled entirely by useAtlasAreaDraw, which calls openAreaPopover
  // + disarm directly instead of going through here).
  const placeAt = useCallback((screenPos: { x: number; y: number }, explicitTool?: AtlasCreationTool, parentIDOverride?: string, linkFromCardID?: string) => {
    const tool = explicitTool ?? armedTool
    if (!tool || tool === 'area' || readOnly) return
    setArmedTool(null)
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
      setPopover({ mode: 'create', anchorPos: screenPos, flowPos, parentIDOverride })
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

  const submitPopover = useCallback((kindID: string, title: string) => {
    setPopover((pending) => {
      if (!pending) return null
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
        const targetParentID = pending.parentIDOverride ?? parentID
        const position = pending.parentIDOverride
          ? freeChildPosition(allCardsRef.current, pending.parentIDOverride)
          : (pending.flowPos ? { X: pending.flowPos.x, Y: pending.flowPos.y } : null)
        void AtlasService.CreateCard(kindID, title, pending.initialNote ?? '', {}, targetParentID, position, ViewMode.$zero, '', '', '')
          .then(() => refreshAtlas())
          .catch(console.error)
      } else if (pending.mode === 'promote' && pending.noteID) {
        void AtlasService.PromoteNote(pending.noteID, kindID, title)
          .then(() => refreshAtlas())
          .catch(console.error)
      } else if (pending.mode === 'area') {
        const position = pending.flowPos ? { X: pending.flowPos.x, Y: pending.flowPos.y } : null
        // An area drawn/grouped via a spatial gesture defaults its OWN
        // children to Canvas mode -- drag filing (and the Area tool
        // itself) is a Free-mode-only interaction, so an area that
        // opened into Shelves by default would make its own creator
        // immediately unable to keep filing cards into it after
        // drilling in.
        void AtlasService.CreateCard(kindID, title, '', {}, parentID, position, ViewMode.ViewModeCanvas, '', '', '')
          .then((created) => Promise.all([
            ...(pending.enclosedCardIDs ?? []).map((id) => AtlasService.MoveCard(id, created.ID)),
            ...(pending.enclosedNoteIDs ?? []).map((id) => AtlasService.MoveNote(id, created.ID)),
          ]))
          .then(() => refreshAtlas())
          .catch(console.error)
      }
      return null
    })
  }, [parentID])

  const commitDraftNote = useCallback((text: string) => {
    setDraftNoteFlowPos((pos) => {
      const trimmed = text.trim()
      if (pos && trimmed) {
        const override = draftNoteParentOverride
        const targetParentID = override ?? parentID
        const position = override ? freeChildPosition(allCardsRef.current, override) : { X: pos.x, Y: pos.y }
        void AtlasService.CreateNote(trimmed, position, targetParentID)
          .then(() => refreshAtlas())
          .catch(console.error)
      }
      return null
    })
    setDraftNoteParentOverride(null)
  }, [parentID, draftNoteParentOverride])
  const cancelDraftNote = useCallback(() => {
    setDraftNoteFlowPos(null)
    setDraftNoteParentOverride(null)
  }, [])

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
    setArmedTool(null)
    setPopover(null)
    setDraftNoteFlowPos(null)
    setDraftNoteParentOverride(null)
    setEditingNoteID(null)
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
    openPromote(promoteRequest.noteID, promoteRequest.pos)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the request's own token
  }, [promoteRequest])

  // Select-then-group (goal 0081 slice A2): reuses screenToFlowPosition
  // to place the new container at the right-click point, same as any
  // other canvas-foremost creation door.
  const lastGroupToken = useRef(groupRequest?.token)
  useEffect(() => {
    if (!groupRequest || groupRequest.token === lastGroupToken.current) return
    lastGroupToken.current = groupRequest.token
    openAreaPopover(groupRequest.pos, screenToFlowPosition(groupRequest.pos), groupRequest.cardIDs, groupRequest.noteIDs)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the request's own token
  }, [groupRequest])

  return {
    armedTool, toggleArm, armTool, disarm, placeAt,
    popover, cancelPopover, submitPopover, openPromote, openPasteText, openAreaPopover, openSlotLinkedCreate,
    draftNoteFlowPos, commitDraftNote, cancelDraftNote,
    editingNoteID, enterNoteEdit, cancelNoteEdit, commitNoteEdit,
    cancelAll,
  }
}

export type AtlasCreation = ReturnType<typeof useAtlasCreation>
