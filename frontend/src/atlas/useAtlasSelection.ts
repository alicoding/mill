import { useCallback, useRef, useState } from 'react'
import type { OnSelectionChangeFunc } from '@xyflow/react'
import type { BoardObject, Card, Note } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'

// Multi-selection state + the two context-menu paths that read it
// (goal 0081; split from AtlasBoard.tsx along the selection seam at
// the 500-line convention).
//
// Ref-only on purpose: selection feeds no render output, and React
// Flow reports a "change" on every nodes-array identity change -- a
// setState here once blew React's update-depth ceiling (React error
// #185) through AnchoredOverlay's inline ref churn. A ref write is
// free and can't re-render.
//
// Two menu paths exist because React Flow renders differently per
// selection size: right-clicking a lone node reaches
// onNodeContextMenu, but with a live multi-selection React Flow draws
// a selection-rectangle overlay OVER the member nodes -- a right-click
// lands on that overlay and never reaches the node handler, so the
// group menu was unreachable through the very gesture that creates
// the selection. onSelectionContextMenu is the overlay's own hook;
// the pointerdown snapshot covers the node-handler path, where React
// Flow re-selects the pressed node (clearing the multi-selection) on
// the SAME pointer-down that later fires onNodeContextMenu.
export function useAtlasSelection({ cards, notes, objects, onMultiSelectContextMenu }: {
  cards: Card[]
  notes: Note[]
  // Board objects (goal 0179/0180): a third split, same shape as
  // cards/notes -- multi-selecting/deleting a mix of cards, notes and
  // objects is one gesture, not three.
  objects: BoardObject[]
  onMultiSelectContextMenu: (cardIDs: string[], noteIDs: string[], objectIDs: string[], pos: { x: number; y: number }) => void
}) {
  const selectedIDsRef = useRef<string[]>([])
  const contextSelectionRef = useRef<string[]>([])
  // Reactive split (owner-caught follow-up to goal 0092): the
  // selection tray and every node type's outline need to re-render on
  // a selection change, unlike the ref-only menu logic above (which
  // deliberately avoids re-rendering -- see this file's own header
  // comment on React error #185). A second, independent state mirror
  // of the same ref, split into card/note/object ids the way
  // openMultiMenu already splits them below.
  const [selectedCards, setSelectedCards] = useState<string[]>([])
  const [selectedNotes, setSelectedNotes] = useState<string[]>([])
  const [selectedObjects, setSelectedObjects] = useState<string[]>([])

  const onSelectionChange: OnSelectionChangeFunc = useCallback(({ nodes: selected }) => {
    const ids = selected.map((n) => n.id)
    selectedIDsRef.current = ids
    setSelectedCards(ids.filter((id) => cards.some((c) => c.ID === id)))
    setSelectedNotes(ids.filter((id) => notes.some((n) => n.ID === id)))
    setSelectedObjects(ids.filter((id) => objects.some((o) => o.ID === id)))
  }, [cards, notes, objects])

  // The selection tray's own clear (Escape, or the tray's clear
  // affordance): resets every split so a stale ref can't reopen a
  // menu against members that no longer read as selected.
  const clearSelection = useCallback(() => {
    selectedIDsRef.current = []
    setSelectedCards([])
    setSelectedNotes([])
    setSelectedObjects([])
  }, [])

  // Snapshot the selection BEFORE React Flow's own handlers re-select
  // the pressed node -- unconditional (not button===2) because a macOS
  // ctrl+click context menu arrives as button 0; a stale snapshot from
  // an earlier press is harmless, since only the context-menu readers
  // consume it and every menu-opening press passes through here first.
  const snapshotSelection = useCallback(() => {
    contextSelectionRef.current = selectedIDsRef.current
  }, [])

  const openMultiMenu = useCallback((sel: string[], pos: { x: number; y: number }): boolean => {
    if (sel.length < 2) return false
    const cardIDs = sel.filter((id) => cards.some((c) => c.ID === id))
    const noteIDs = sel.filter((id) => notes.some((n) => n.ID === id))
    const objectIDs = sel.filter((id) => objects.some((o) => o.ID === id))
    onMultiSelectContextMenu(cardIDs, noteIDs, objectIDs, pos)
    return true
  }, [cards, notes, objects, onMultiSelectContextMenu])

  const onSelectionContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    openMultiMenu(selectedIDsRef.current, { x: e.clientX, y: e.clientY })
  }, [openMultiMenu])

  // For onNodeContextMenu: the pre-clear snapshot is the authoritative
  // selection, never the live (already re-selected) state. Returns
  // whether the multi menu opened, so the caller falls through to its
  // per-node menus otherwise.
  const tryNodeMultiMenu = useCallback((nodeID: string, pos: { x: number; y: number }): boolean => {
    const sel = contextSelectionRef.current
    if (!sel.includes(nodeID)) return false
    return openMultiMenu(sel, pos)
  }, [openMultiMenu])

  // The click model's own commit test (goal 0102's gesture table,
  // "click an already-selected card"): true when this node was the
  // SOLE selected node the instant this click gesture began -- the
  // same pre-select snapshot onNodeContextMenu reads above, reused so
  // two rapid plain clicks (select, then commit) and a real
  // double-click land on the identical outcome.
  const isSoleSelected = useCallback((id: string): boolean => {
    const sel = contextSelectionRef.current
    return sel.length === 1 && sel[0] === id
  }, [])

  return { selectedIDsRef, selectedCards, selectedNotes, selectedObjects, onSelectionChange, snapshotSelection, onSelectionContextMenu, tryNodeMultiMenu, isSoleSelected, clearSelection }
}
