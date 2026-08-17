import { useCallback, useRef } from 'react'
import type { OnSelectionChangeFunc } from '@xyflow/react'
import type { Card, Note } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'

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
export function useAtlasSelection({ cards, notes, onMultiSelectContextMenu }: {
  cards: Card[]
  notes: Note[]
  onMultiSelectContextMenu: (cardIDs: string[], noteIDs: string[], pos: { x: number; y: number }) => void
}) {
  const selectedIDsRef = useRef<string[]>([])
  const contextSelectionRef = useRef<string[]>([])

  const onSelectionChange: OnSelectionChangeFunc = useCallback(({ nodes: selected }) => {
    selectedIDsRef.current = selected.map((n) => n.id)
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
    onMultiSelectContextMenu(cardIDs, noteIDs, pos)
    return true
  }, [cards, notes, onMultiSelectContextMenu])

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

  return { selectedIDsRef, onSelectionChange, snapshotSelection, onSelectionContextMenu, tryNodeMultiMenu }
}
