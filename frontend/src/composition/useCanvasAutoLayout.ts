import { useCallback, useState } from 'react'
import type { CanvasStore } from './canvasStore'
import { CANVAS_NODE_WIDTH, CANVAS_NODE_HEIGHT } from './canvasConstants'

// Split out of CompositionCanvas.tsx at the 500-line limit (CLAUDE.md)
// -- the elkjs-driven auto-layout call is self-contained enough to own
// its own `layingOut` state, the same "split along a real seam"
// discipline useCanvasHotExit.ts/useCanvasSave.ts already established
// for this file's other non-rendering concerns. Only ever re-arranges
// the store's `nodes` (steps) -- notes (docs/goals/0055) keep their
// manually placed position, since they aren't part of the execution
// graph ELK is laying out.
export function useCanvasAutoLayout(useCanvasStore: CanvasStore): { layingOut: boolean; runAutoLayout: () => Promise<void> } {
  const [layingOut, setLayingOut] = useState(false)

  const runAutoLayout = useCallback(async () => {
    setLayingOut(true)
    try {
      // elkjs is a large (~1-2MB) synchronous bundle -- dynamically
      // imported only when Auto-layout is actually clicked, not part of
      // the main chunk embedded via //go:embed.
      const { default: ELK } = await import('elkjs/lib/elk.bundled.js')
      const elk = new ELK()
      const { nodes: currentNodes, edges: currentEdges } = useCanvasStore.getState()
      const graph = {
        id: 'root',
        // DOWN, not RIGHT -- matches the top/bottom handle positions
        // CanvasNodeView.tsx uses, so an auto-laid-out chain reads as
        // one straight column with each edge centered under the node
        // above it, not a diagonal left-to-right sprawl.
        layoutOptions: {
          'elk.algorithm': 'layered',
          'elk.direction': 'DOWN',
          'elk.spacing.nodeNode': '48',
          'elk.layered.spacing.nodeNodeBetweenLayers': '64',
        },
        children: currentNodes.map((n) => ({ id: n.id, width: CANVAS_NODE_WIDTH, height: CANVAS_NODE_HEIGHT })),
        edges: currentEdges.map((e) => ({ id: e.id, sources: [e.source], targets: [e.target] })),
      }
      const layouted = await elk.layout(graph)
      const byId = new Map((layouted.children ?? []).map((c) => [c.id, c]))
      const positioned = currentNodes.map((n) => {
        const l = byId.get(n.id)
        return l && l.x !== undefined && l.y !== undefined ? { ...n, position: { x: l.x, y: l.y } } : n
      })
      useCanvasStore.getState().load(positioned, currentEdges)
    } finally {
      setLayingOut(false)
    }
  }, [useCanvasStore])

  return { layingOut, runAutoLayout }
}
