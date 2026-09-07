import { useCallback, useEffect, useRef } from 'react'
import type { RefObject } from 'react'
import type { Node } from '@xyflow/react'
import { isEditableTarget } from '../shared/keybinding'
import { useAppStore } from '../shared/store'
import { runCommand } from '../shared/commands'
import { atlasSelectionContext } from '../shared/atlasSelectionStore'
import { isFocusInsideBoard, readSelectedNodeIDs } from './atlasFocusContainment'

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
// signal. Escape's own ladder (goal 0102's gesture table): clear
// whatever selection exists, or -- with nothing selected -- go up one
// level (the same signal ⌘↑/atlas.up bumps), never a broken empty
// press at the top.
//
// The window keydown listener registers exactly ONCE (empty deps) and
// reads every value through a ref -- registering it per-dependency-
// change (selectedCards/selectedNotes are fresh arrays most renders,
// and callers pass inline callbacks) reopened a real gap where a fast
// keypress landed between an unsubscribe and the next resubscribe and
// was silently dropped.
export function useAtlasSelectionTray<TNode extends Node>({
  selectedCards, selectedNotes, selectedObjects, clearSelection, setNodes, wrapperRef,
}: {
  selectedCards: string[]
  selectedNotes: string[]
  // Board objects: full Group peers alongside cards and notes (goal
  // 0266's peer law, reversing the earlier board-local-never-files
  // decision), and part of the visibility threshold and Delete.
  selectedObjects: string[]
  clearSelection: () => void
  setNodes: (updater: (nodes: TNode[]) => TNode[]) => void
  // Escape's own ladder must never fire on top of some OTHER surface
  // (a Dialog, a popover) that's legitimately consuming the same
  // keypress to close/cancel itself -- see atlasFocusContainment.ts's
  // own header comment for the regression this guards.
  wrapperRef: RefObject<HTMLElement | null>
}) {
  const trayRef = useRef<HTMLDivElement>(null)
  // The tray's own visibility threshold stays >=2 (not >=1): a plain
  // click now genuinely selects a single card (goal 0102), and
  // flashing the Group/Delete tray for every ordinary single-select
  // would be noisier than the "+ Add" creation tray it replaces.
  // Escape's own clear-selection rung below reads the DOM directly
  // instead (readSelectedNodeIDs) -- it clears ANY live selection, not
  // only a 2+ one, and can't wait on this state mirror's own timing.
  const hasSelection = selectedCards.length + selectedNotes.length + selectedObjects.length >= 2

  const latest = useRef({ selectedCards, selectedNotes, selectedObjects, hasSelection, clearSelection, setNodes })
  useEffect(() => {
    latest.current = { selectedCards, selectedNotes, selectedObjects, hasSelection, clearSelection, setNodes }
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

  // Group and Delete run the registry commands over the live selection
  // (goal 0346 slice B) -- the same two the right-click menu and the
  // palette run; the command's own enablement is the 2+ threshold.
  const triggerGroup = useCallback((pos: { x: number; y: number }) => {
    void runCommand('atlas.group.selection', atlasSelectionContext(undefined, { pos }))
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
        // Primer's own Escape composition contract (useOnEscapePress):
        // a Dialog/Overlay that already closed itself off this SAME
        // keypress calls preventDefault(), and every other registered
        // handler must honor that instead of re-deciding from
        // isFocusInsideBoard alone -- a Dialog/AnchoredOverlay closing
        // synchronously resets document.activeElement to <body> before
        // this handler runs, which isFocusInsideBoard's own "nothing
        // has focus" fallback misreads as "belongs to the board"
        // (docs/goals/0183: this window listener never checked
        // defaultPrevented at all, silently climbing a level behind
        // Escape closing an unrelated card page or context menu).
        if (e.defaultPrevented) return
        if (isEditableTarget(e.target) || !isFocusInsideBoard(wrapperRef)) return
        // Read the DOM directly, not the selectedCards/selectedNotes
        // state mirror -- see readSelectedNodeIDs' own header comment
        // for the render-order gap a fresh click's own Escape can hit.
        const ids = readSelectedNodeIDs(wrapperRef)
        if (ids.length > 0) clearAll()
        else useAppStore.getState().requestAtlasUp()
        return
      }
      if (e.metaKey || e.ctrlKey || e.altKey || isEditableTarget(e.target)) return
      const sel = latest.current
      if (e.key.toUpperCase() !== 'G' || sel.selectedCards.length + sel.selectedNotes.length + sel.selectedObjects.length < 2) return
      e.preventDefault()
      groupFromKeyboard()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [clearAll, groupFromKeyboard, wrapperRef])

  return { trayRef, hasSelection, onGroup: triggerGroup, onDelete: () => { void runCommand('atlas.delete.selection', atlasSelectionContext()) } }
}
