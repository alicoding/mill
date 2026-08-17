import { useCallback, useEffect, useRef } from 'react'
import type { Node } from '@xyflow/react'
import { isEditableTarget } from '../shared/keybinding'

// The selection tray's own state glue + keyboard doors (owner-caught
// follow-up to goal 0092: a multi-selection had no visible state and
// no action surface). Own file (architecture.md's 500-line convention
// -- AtlasBoard.tsx sits at the cap) so the board only ever calls this
// once and renders whatever it returns.
//
// Bare G groups the live selection -- same arming-guard shape as the
// creation tray's own bare C/N/A (app/useKeymapDispatch.ts), kept
// local here rather than in that app-level dispatcher since the
// selection it acts on is this board's own state, not a cross-surface
// signal. Escape's selection-clear takes precedence over the board's
// own unflip duty: a live selection is the front-most transient state.
//
// The window keydown listener registers exactly ONCE (empty deps) and
// reads every value through a ref -- registering it per-dependency-
// change (selectedCards/selectedNotes are fresh arrays most renders,
// and callers pass inline callbacks) reopened a real gap where a fast
// keypress landed between an unsubscribe and the next resubscribe and
// was silently dropped (confirmed live: Escape right after a flip
// intermittently never reached this handler at all).
export function useAtlasSelectionTray<TNode extends Node>({
  selectedCards, selectedNotes, clearSelection, setNodes, onDeleteSelection, onGroupSelection, onUnflip,
}: {
  selectedCards: string[]
  selectedNotes: string[]
  clearSelection: () => void
  setNodes: (updater: (nodes: TNode[]) => TNode[]) => void
  onDeleteSelection: (cardIDs: string[], noteIDs: string[]) => void
  onGroupSelection: (cardIDs: string[], noteIDs: string[], pos: { x: number; y: number }) => void
  onUnflip: () => void
}) {
  const trayRef = useRef<HTMLDivElement>(null)
  // >=2, not >=1: React Flow selects the clicked node on ANY plain
  // click (the flip gesture included), independent of Shift -- >=1
  // would make the tray/Escape-clear fire on every ordinary flip.
  // >=2 is the same "real multi-selection" threshold openMultiMenu's
  // own sel.length check already uses.
  const hasSelection = selectedCards.length + selectedNotes.length >= 2

  const latest = useRef({ selectedCards, selectedNotes, hasSelection, clearSelection, setNodes, onDeleteSelection, onGroupSelection, onUnflip })
  useEffect(() => {
    latest.current = { selectedCards, selectedNotes, hasSelection, clearSelection, setNodes, onDeleteSelection, onGroupSelection, onUnflip }
  })

  // Clears BOTH halves: React Flow's own node.selected flags (so the
  // outline/overlay disappear) and useAtlasSelection's own ref+state
  // (so a stale selection can't reopen a menu or re-arm G) -- neither
  // side is provably sufficient alone without depending on React
  // Flow's internal timing for re-deriving the other.
  const clearAll = useCallback(() => {
    latest.current.clearSelection()
    latest.current.setNodes((nds) => nds.map((n) => (n.selected ? { ...n, selected: false } : n)))
  }, [])

  const triggerGroup = useCallback((pos: { x: number; y: number }) => {
    const { selectedCards: cards, selectedNotes: notes, onGroupSelection: onGroup } = latest.current
    if (cards.length >= 2) onGroup(cards, notes, pos)
  }, [])

  // Bare-G has no click point of its own -- anchors the SAME popover a
  // click would, at the tray's own on-screen position.
  const groupFromKeyboard = useCallback(() => {
    const rect = trayRef.current?.getBoundingClientRect()
    triggerGroup(rect ? { x: rect.left + rect.width / 2, y: rect.top } : { x: 0, y: 0 })
  }, [triggerGroup])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (latest.current.hasSelection) clearAll()
        else latest.current.onUnflip()
        return
      }
      if (e.metaKey || e.ctrlKey || e.altKey || isEditableTarget(e.target)) return
      if (e.key.toUpperCase() !== 'G' || latest.current.selectedCards.length < 2) return
      e.preventDefault()
      groupFromKeyboard()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [clearAll, groupFromKeyboard])

  return { trayRef, hasSelection, onGroup: triggerGroup, onDelete: () => onDeleteSelection(selectedCards, selectedNotes) }
}
