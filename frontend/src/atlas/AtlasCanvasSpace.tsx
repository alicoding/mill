import { useEffect, useMemo } from 'react'
import { ReactFlow, ReactFlowProvider, Background, Controls, useNodesState } from '@xyflow/react'
import type { NodeTypes as RFNodeTypes } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { Card, Kind } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { AtlasService } from '../shared/bindings'
import { useIsNarrowViewport } from '../shared/useNarrowViewport'
import { childrenOf } from './atlasGrouping'
import { AtlasCanvasCardNode, type AtlasCanvasRFNode } from './AtlasCanvasCardNode'
import { ATLAS_CARD_HEIGHT, ATLAS_CARD_WIDTH } from './atlasCanvasConstants'
import styles from './AtlasCanvasSpace.module.css'

const rfNodeTypes: RFNodeTypes = { 'atlas-card': AtlasCanvasCardNode }

// Canvas mode (docs/goals/0061): every child at its saved Position,
// React Flow -- the composition canvas's own idiom (Background,
// Controls, zoomOnDoubleClick={false}) reused directly rather than
// re-derived, minus undo/redo and edges (a space has no connections to
// draw, only placement). A card with no saved Position yet (created
// while shelves mode was active, later switched to canvas) falls back
// to the origin -- SetPosition on its first drag then gives it a real
// one.
function AtlasCanvasInner({ cards, allCards, kinds, peeking, onDrill, onOpenOverlay }: {
  cards: Card[]
  allCards: Card[]
  kinds: Kind[]
  peeking: boolean
  onDrill: (id: string) => void
  onOpenOverlay: (id: string) => void
}) {
  // Canvas mode never gets touch editing (goal 0068's companion-not-
  // second-instance framing: authoring stays desktop-only) -- a narrow
  // viewport gets pan/zoom (React Flow's own pinch/drag gestures stay
  // on) but no card dragging and no position writes.
  const readOnly = useIsNarrowViewport()
  const builtNodes: AtlasCanvasRFNode[] = useMemo(() => {
    const kindByID = new Map(kinds.map((k) => [k.ID, k]))
    return cards.map((card) => ({
      id: card.ID,
      type: 'atlas-card',
      position: { x: card.Position?.X ?? 0, y: card.Position?.Y ?? 0 },
      width: ATLAS_CARD_WIDTH,
      height: ATLAS_CARD_HEIGHT,
      data: {
        card,
        kind: kindByID.get(card.KindID),
        childCount: childrenOf(allCards, card.ID).length,
        peeking,
        onDrill,
        onOpenOverlay,
      },
    }))
  }, [cards, allCards, kinds, peeking, onDrill, onOpenOverlay])

  // React Flow must own node state during interaction: a static
  // `nodes` prop with no onNodesChange makes every drag frame
  // reconcile against the frozen prop -- the canvas visibly fights
  // the pointer. useNodesState + onNodesChange is the same idiom
  // CompositionCanvas already uses; data-driven rebuilds re-sync via
  // the effect below.
  const [nodes, setNodes, onNodesChange] = useNodesState(builtNodes)
  useEffect(() => {
    setNodes(builtNodes)
  }, [builtNodes, setNodes])

  return (
    <div className={styles.canvas} data-testid="atlas-canvas">
      <ReactFlow
        nodes={nodes}
        onNodesChange={onNodesChange}
        edges={[]}
        nodeTypes={rfNodeTypes}
        nodesConnectable={false}
        nodesDraggable={!readOnly}
        zoomOnDoubleClick={false}
        onNodeDragStop={readOnly ? undefined : (_, node) => {
          void AtlasService.SetPosition(node.id, { X: node.position.x, Y: node.position.y }).catch(console.error)
        }}
        fitView
        fitViewOptions={{ maxZoom: 1, padding: 0.25 }}
      >
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  )
}

export function AtlasCanvasSpace(props: Parameters<typeof AtlasCanvasInner>[0]) {
  return (
    <ReactFlowProvider>
      <AtlasCanvasInner {...props} />
    </ReactFlowProvider>
  )
}
