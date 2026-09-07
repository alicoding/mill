import type { Dispatch, MouseEvent as ReactMouseEvent, SetStateAction } from 'react'
import type { TFunction } from 'i18next'
import type { Edge as RFEdge, Node as RFNode } from '@xyflow/react'
import type { ContextMenuState } from '../shared/ContextMenu'
import { buildStepContextMenuItems } from './stepContextMenu'
import { buildEdgeContextMenuItems, buildPaneContextMenuItems } from './canvasContextMenus'

// The three ReactFlow context-menu openers (goal 0075's audits G3/G4),
// split out of CompositionCanvas.tsx at the 500-line convention: each
// only decides WHAT the menu shows for its target -- step, edge, or
// empty pane -- reusing the same builder functions the pane/edge
// locale-driven items come from.
export function useCanvasContextMenuHandlers({
  t, readOnly, setSelectedNodeId, setSelectedEdgeId, setContextMenu,
}: {
  t: TFunction<'composition'>
  readOnly: boolean
  setSelectedNodeId: Dispatch<SetStateAction<string | null>>
  setSelectedEdgeId: Dispatch<SetStateAction<string | null>>
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
      items: buildStepContextMenuItems(t, node.id),
    })
  }

  const onEdgeContextMenu = (e: ReactMouseEvent, edge: RFEdge) => {
    e.preventDefault()
    setContextMenu({
      x: e.clientX, y: e.clientY,
      items: buildEdgeContextMenuItems(t, edge.id),
    })
  }

  const onPaneContextMenu = (e: ReactMouseEvent | MouseEvent) => {
    e.preventDefault()
    // View mode: bare preventDefault only -- an empty menu (nothing
    // addable) is worse than none.
    if (readOnly) return
    setContextMenu({
      x: e.clientX, y: e.clientY,
      items: buildPaneContextMenuItems(t, { x: e.clientX, y: e.clientY }),
    })
  }

  return { onNodeContextMenu, onEdgeContextMenu, onPaneContextMenu }
}
