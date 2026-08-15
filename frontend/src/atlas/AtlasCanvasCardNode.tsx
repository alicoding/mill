import type { NodeProps, Node as RFNode } from '@xyflow/react'
import type { Card, Kind } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { AtlasCardBody } from './AtlasCardBody'
import styles from './AtlasCanvasSpace.module.css'

export interface AtlasCanvasNodeData extends Record<string, unknown> {
  card: Card
  kind: Kind | undefined
  childCount: number
  peeking: boolean
  onDrill: (id: string) => void
  onOpenOverlay: (id: string) => void
}

export type AtlasCanvasRFNode = RFNode<AtlasCanvasNodeData>

// One React Flow node type for every Atlas card in canvas mode --
// body-click drills (mirrors CompositionCanvas.tsx's node-click
// selection idiom, here firing the drill directly since a card has no
// separate "select then inspect" step the way a workflow step does),
// the info button (inside AtlasCardBody, `nodrag nopan`) opens the
// overlay without starting a drag or triggering the drill.
export function AtlasCanvasCardNode({ data }: NodeProps<AtlasCanvasRFNode>) {
  return (
    <div
      className={styles.cardNode}
      data-testid="atlas-canvas-card"
      onClick={() => data.onDrill(data.card.ID)}
    >
      <AtlasCardBody
        card={data.card}
        kind={data.kind}
        childCount={data.childCount}
        peeking={data.peeking}
        onOpenOverlay={() => data.onOpenOverlay(data.card.ID)}
      />
    </div>
  )
}
