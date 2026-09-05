import { useCallback } from 'react'
import type { Node } from '@xyflow/react'

// The board's one node-right-click router (split out of AtlasBoard.tsx
// at the 500-line convention): dispatches to the right context menu by
// node type, ahead of any node-local right-click handler.
export function useAtlasNodeContextMenu({
  tryNodeMultiMenu,
  onNoteContextMenu,
  onObjectContextMenu,
  onFrameContextMenu,
  onFrameInteriorContextMenu,
  onCardContextMenu,
}: {
  tryNodeMultiMenu: (id: string, pos: { x: number; y: number }) => boolean
  onNoteContextMenu: (id: string, pos: { x: number; y: number }) => void
  onObjectContextMenu: (id: string, pos: { x: number; y: number }) => void
  onFrameContextMenu: (id: string, pos: { x: number; y: number }) => void
  onFrameInteriorContextMenu: (id: string, pos: { x: number; y: number }) => void
  onCardContextMenu: (id: string, pos: { x: number; y: number }) => void
}) {
  return useCallback((e: React.MouseEvent, node: Node) => {
    e.preventDefault()
    // A right-click on a member of a live 2+ multi-selection
    // opens the group menu (goal 0081 slice A2, LOCKED design 6d);
    // the hook reads its pre-clear snapshot, never live state.
    if (tryNodeMultiMenu(node.id, { x: e.clientX, y: e.clientY })) return
    if (node.type === 'atlas-sticky') {
      onNoteContextMenu(node.id, { x: e.clientX, y: e.clientY })
      return
    }
    if (node.type === 'atlas-object') {
      onObjectContextMenu(node.id, { x: e.clientX, y: e.clientY })
      return
    }
    if (node.type === 'atlas-group') {
      // The header is the ONLY part of a frame's chrome that
      // isn't "interior empty space" -- everywhere else on the
      // frame's own DOM (its background, never a child node,
      // which captures its own right-click first) routes to the
      // frame-interior door instead of the full frame menu.
      const onHeader = !!(e.target as HTMLElement).closest('[data-testid="atlas-group-header"]')
      if (onHeader) onFrameContextMenu(node.id, { x: e.clientX, y: e.clientY })
      else onFrameInteriorContextMenu(node.id, { x: e.clientX, y: e.clientY })
      return
    }
    onCardContextMenu(node.id, { x: e.clientX, y: e.clientY })
  }, [tryNodeMultiMenu, onNoteContextMenu, onObjectContextMenu, onFrameContextMenu, onFrameInteriorContextMenu, onCardContextMenu])
}
