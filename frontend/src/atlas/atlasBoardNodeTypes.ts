import type { EdgeTypes as RFEdgeTypes, NodeTypes as RFNodeTypes } from '@xyflow/react'
import { AtlasNoteCardNode } from './AtlasNoteCardNode'
import { AtlasTableCardNode } from './AtlasTableCardNode'
import { AtlasGroupNode } from './AtlasGroupNode'
import { AtlasRegionChipNode } from './AtlasRegionChipNode'
import { AtlasStickyNode } from './AtlasStickyNode'
import { AtlasBoardObjectNode } from './AtlasBoardObjectNode'
import { AtlasLinkEdge } from './AtlasLinkEdge'

// The board's React Flow node/edge type registries -- split out of
// AtlasBoard.tsx at the 500-line limit: a new node type (the table
// projection was the fifth) registers here without touching the board.
// 'atlas-object' (goal 0179/0180) is ONE type for every board-local
// canvas kind (image, ink, ...) -- a new kind is a declaration inside
// AtlasBoardObjectNode itself, never a new entry here.
export const rfNodeTypes: RFNodeTypes = {
  'atlas-note': AtlasNoteCardNode,
  'atlas-group': AtlasGroupNode,
  'atlas-region-chip': AtlasRegionChipNode,
  'atlas-sticky': AtlasStickyNode,
  'atlas-table': AtlasTableCardNode,
  'atlas-object': AtlasBoardObjectNode,
}

export const rfEdgeTypes: RFEdgeTypes = { 'atlas-link': AtlasLinkEdge }
