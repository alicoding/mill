import type { EdgeTypes as RFEdgeTypes, NodeTypes as RFNodeTypes } from '@xyflow/react'
import { AtlasNoteCardNode } from './AtlasNoteCardNode'
import { AtlasTableCardNode } from './AtlasTableCardNode'
import { AtlasGroupNode } from './AtlasGroupNode'
import { AtlasRegionChipNode } from './AtlasRegionChipNode'
import { AtlasStickyNode } from './AtlasStickyNode'
import { AtlasLinkEdge } from './AtlasLinkEdge'

// The board's React Flow node/edge type registries -- split out of
// AtlasBoard.tsx at the 500-line limit: a new node type (the table
// projection was the fifth) registers here without touching the board.
export const rfNodeTypes: RFNodeTypes = {
  'atlas-note': AtlasNoteCardNode,
  'atlas-group': AtlasGroupNode,
  'atlas-region-chip': AtlasRegionChipNode,
  'atlas-sticky': AtlasStickyNode,
  'atlas-table': AtlasTableCardNode,
}

export const rfEdgeTypes: RFEdgeTypes = { 'atlas-link': AtlasLinkEdge }
