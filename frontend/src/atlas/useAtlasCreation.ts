import { useCallback, useEffect, useRef, useState } from 'react'
import { ViewMode } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import type { Note } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { AtlasService } from '../shared/bindings'
import { useUISignalStore } from '../shared/uiSignalStore'
import { refreshAtlas } from './atlasStore'
import { titleFromNoteText } from './atlasCreateHelpers'
import type { AtlasCreationTool } from './AtlasCreationTray'

export interface AtlasPlacementPopoverState {
  mode: 'create' | 'promote'
  anchorPos: { x: number; y: number }
  flowPos?: { x: number; y: number }
  noteID?: string
  initialTitle?: string
}

// AtlasView's own downward creation requests -- the pane right-click
// menu's "Add card"/"Add note"/"Promote to card…" items (goal 0081
// slice A1) place/promote AT the click point directly, bypassing the
// armed-tool state entirely. Same token-carrying shape as
// shared/uiSignalStore.ts's atlasArmToolRequest, one level down (this
// one is AtlasView-local state, not a cross-bounded-context signal,
// since the pane ContextMenu's own item.run() closures are defined
// right there in AtlasView already).
export interface AtlasPlacementRequest { tool: AtlasCreationTool; pos: { x: number; y: number }; token: number }
export interface AtlasPromoteRequest { noteID: string; pos: { x: number; y: number }; token: number }

// The full arm -> place -> confirm state machine behind the creation
// tray, right-click create, sticky notes, and note promotion (goal
// 0081 slice A1's LOCKED design) -- split out of AtlasBoard.tsx
// (architecture.md's 500-line convention) since this is the bulk of
// the new interaction surface. parentID is the board's OWN current
// container (AtlasView's viewedID, threaded down unchanged) -- the
// LOCKED design's "parent = where you are" rule for every canvas-
// foremost creation door.
export function useAtlasCreation({ parentID, notes, readOnly, screenToFlowPosition, placementRequest, promoteRequest }: {
  parentID: string
  notes: Note[]
  readOnly: boolean
  screenToFlowPosition: (p: { x: number; y: number }) => { x: number; y: number }
  placementRequest?: AtlasPlacementRequest | null
  promoteRequest?: AtlasPromoteRequest | null
}) {
  const [armedTool, setArmedTool] = useState<AtlasCreationTool | null>(null)
  const [popover, setPopover] = useState<AtlasPlacementPopoverState | null>(null)
  const [draftNoteFlowPos, setDraftNoteFlowPos] = useState<{ x: number; y: number } | null>(null)
  const [editingNoteID, setEditingNoteID] = useState<string | null>(null)

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
  const placeAt = useCallback((screenPos: { x: number; y: number }, explicitTool?: AtlasCreationTool) => {
    const tool = explicitTool ?? armedTool
    if (!tool || readOnly) return
    setArmedTool(null)
    const flowPos = screenToFlowPosition(screenPos)
    if (tool === 'card') {
      setPopover({ mode: 'create', anchorPos: screenPos, flowPos })
    } else {
      setDraftNoteFlowPos(flowPos)
    }
  }, [armedTool, readOnly, screenToFlowPosition])

  const openPromote = useCallback((noteID: string, screenPos: { x: number; y: number }) => {
    const note = notes.find((n) => n.ID === noteID)
    if (!note) return
    setPopover({ mode: 'promote', anchorPos: screenPos, noteID, initialTitle: titleFromNoteText(note.Text) })
  }, [notes])

  const cancelPopover = useCallback(() => setPopover(null), [])

  const submitPopover = useCallback((kindID: string, title: string) => {
    setPopover((pending) => {
      if (!pending) return null
      if (pending.mode === 'create' && pending.flowPos) {
        void AtlasService.CreateCard(kindID, title, '', {}, parentID, { X: pending.flowPos.x, Y: pending.flowPos.y }, ViewMode.$zero, '', '', '')
          .then(() => refreshAtlas())
          .catch(console.error)
      } else if (pending.mode === 'promote' && pending.noteID) {
        void AtlasService.PromoteNote(pending.noteID, kindID, title)
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
        void AtlasService.CreateNote(trimmed, { X: pos.x, Y: pos.y }, parentID)
          .then(() => refreshAtlas())
          .catch(console.error)
      }
      return null
    })
  }, [parentID])
  const cancelDraftNote = useCallback(() => setDraftNoteFlowPos(null), [])

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
  // this) -- cancels whichever of the four transient states is
  // currently open. All four setters are no-ops when already null/false,
  // so calling every one unconditionally is safe.
  const cancelAll = useCallback(() => {
    setArmedTool(null)
    setPopover(null)
    setDraftNoteFlowPos(null)
    setEditingNoteID(null)
  }, [])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cancelAll()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [cancelAll])

  // atlas.create.card/note's own bare C/N keypress (shared/commands.ts,
  // app/useKeymapDispatch.ts) -- always ARMS (never toggles), matching
  // the tray's own click-to-arm, distinct from clicking an
  // already-armed tool (which does toggle, AtlasCreationTray.tsx).
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
    placeAt(placementRequest.pos, placementRequest.tool)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the request's own token, same shape as every other one-shot signal in this file
  }, [placementRequest])

  const lastPromoteToken = useRef(promoteRequest?.token)
  useEffect(() => {
    if (!promoteRequest || promoteRequest.token === lastPromoteToken.current) return
    lastPromoteToken.current = promoteRequest.token
    openPromote(promoteRequest.noteID, promoteRequest.pos)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the request's own token
  }, [promoteRequest])

  return {
    armedTool, toggleArm, armTool, disarm, placeAt,
    popover, cancelPopover, submitPopover, openPromote,
    draftNoteFlowPos, commitDraftNote, cancelDraftNote,
    editingNoteID, enterNoteEdit, cancelNoteEdit, commitNoteEdit,
    cancelAll,
  }
}

export type AtlasCreation = ReturnType<typeof useAtlasCreation>
