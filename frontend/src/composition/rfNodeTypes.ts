import type { NodeTypes as RFNodeTypes } from '@xyflow/react'
import { CanvasNodeView } from './CanvasNodeView'

// React Flow's own nodeTypes registry maps every Kind to the same
// CanvasNodeView component (its rendering doesn't branch on Kind beyond
// icon/color lookups already keyed by data.kind, so one component
// covers all six). Split out of CanvasNodeView.tsx -- a plain config
// object doesn't belong in a component-only file (react-refresh's own
// only-export-components rule flags exactly this).
export const rfNodeTypes: RFNodeTypes = {
  trigger: CanvasNodeView,
  capture: CanvasNodeView,
  process: CanvasNodeView,
  apply: CanvasNodeView,
  decision: CanvasNodeView,
  terminal: CanvasNodeView,
}
