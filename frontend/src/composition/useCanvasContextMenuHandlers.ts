import type { Dispatch, MouseEvent as ReactMouseEvent, SetStateAction } from 'react'
import type { TFunction } from 'i18next'
import type { Edge as RFEdge, Node as RFNode, XYPosition } from '@xyflow/react'
import type { ContextMenuState } from '../shared/ContextMenu'
import { buildStepContextMenuItems } from './stepContextMenu'
import { buildEdgeContextMenuItems, buildPaneContextMenuItems } from './canvasContextMenus'

// The three ReactFlow context-menu openers (goal 0075's audits G3/G4),
// split out of CompositionCanvas.tsx at the 500-line convention: each
// only decides WHAT the menu shows for its target -- step, edge, or
// empty pane -- reusing the same builder functions the pane/edge
// locale-driven items come from.
export function useCanvasContextMenuHandlers({
  t, readOnly, removeNode, removeEdge, screenToFlowPosition, addNoteNear, setPaletteOpen,
  setSelectedNodeId, setSelectedEdgeId, setDetailOpen, setContextMenu,
}: {
  t: TFunction<'composition'>
  readOnly: boolean
  removeNode: (id: string) => void
  removeEdge: (id: string) => void
  screenToFlowPosition: (pos: XYPosition) => XYPosition
  addNoteNear: (pos: XYPosition) => void
  setPaletteOpen: Dispatch<SetStateAction<boolean>>
  setSelectedNodeId: Dispatch<SetStateAction<string | null>>
  setSelectedEdgeId: Dispatch<SetStateAction<string | null>>
  setDetailOpen: Dispatch<SetStateAction<boolean>>
  setContextMenu: Dispatch<SetStateAction<ContextMenuState | null>>
}) {
  const onNodeContextMenu = (e: ReactMouseEvent, node: RFNode) => {
    e.preventDefault()
    // A note (docs/goals/0055) keeps its own inline-edit model, no menu.
    if (node.type === 'note') return
    setSelectedNodeId(node.id)
    setSelectedEdgeId(null)
    setContextMenu({
      x: e.clientX, y: e.clientY,
      items: buildStepContextMenuItems(t, readOnly, node.id, { openDetails: () => setDetailOpen(true), removeNode }),
    })
  }

  const onEdgeContextMenu = (e: ReactMouseEvent, edge: RFEdge) => {
    e.preventDefault()
    setContextMenu({
      x: e.clientX, y: e.clientY,
      items: buildEdgeContextMenuItems(t, readOnly, edge.id, {
        selectEdge: (id) => { setSelectedEdgeId(id); setSelectedNodeId(null) },
        removeEdge,
      }),
    })
  }

  const onPaneContextMenu = (e: ReactMouseEvent | MouseEvent) => {
    e.preventDefault()
    // View mode: bare preventDefault only -- an empty menu (nothing
    // addable) is worse than none.
    if (readOnly) return
    const flowPos = screenToFlowPosition({ x: e.clientX, y: e.clientY })
    setContextMenu({
      x: e.clientX, y: e.clientY,
      items: buildPaneContextMenuItems(t, { toggleAddSteps: () => setPaletteOpen((v) => !v), addNote: () => addNoteNear(flowPos) }),
    })
  }

  return { onNodeContextMenu, onEdgeContextMenu, onPaneContextMenu }
}
