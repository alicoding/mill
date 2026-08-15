import { useMemo } from 'react'
import { ReactFlow, ReactFlowProvider, Background, Controls } from '@xyflow/react'
import type { NodeTypes as RFNodeTypes } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { Card, Kind } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { AtlasService } from '../shared/bindings'
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
  const nodes: AtlasCanvasRFNode[] = useMemo(() => {
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

  return (
    <div className={styles.canvas} data-testid="atlas-canvas">
      <ReactFlow
        nodes={nodes}
        edges={[]}
        nodeTypes={rfNodeTypes}
        nodesConnectable={false}
        zoomOnDoubleClick={false}
        onNodeDragStop={(_, node) => {
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
