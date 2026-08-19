import { useCallback, useMemo, useState } from 'react'
import type { TFunction } from 'i18next'
import type { OnSelectionChangeFunc } from '@xyflow/react'
import type { LinkKind } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import type { ResolvedBoardEdge } from './atlasLinkResolution'
import { buildBoardEdges } from './atlasBuildBoardEdges'

// The board's own edge hover/selection state (goal 0124 slice 2) plus
// the RF-ready edges it feeds -- split out of AtlasBoard.tsx at the
// 500-line seam since this is a self-contained concern: which edge is
// hovered/pinned drives the hover chip's own visibility, and both
// states are threaded straight into buildBoardEdges.
export function useAtlasEdgeInteraction({
  arteries, linkKinds, t, onEdgeDeleteLink, onEdgeChangeKind, onNodeSelectionChange,
}: {
  arteries: ResolvedBoardEdge[]
  linkKinds: LinkKind[]
  t: TFunction<'atlas'>
  onEdgeDeleteLink: (linkID: string) => void
  onEdgeChangeKind: (linkID: string, pos: { x: number; y: number }) => void
  onNodeSelectionChange: OnSelectionChangeFunc
}) {
  const [hoveredEdgeID, setHoveredEdgeID] = useState<string | null>(null)
  // The hover chip's own pin: a click on an edge keeps its chip
  // visible without the pointer staying over it, e.g. to reach the
  // chip's own buttons on a touch surface. Cleared by clicking
  // anything else (empty canvas, a different edge, a node).
  const [selectedEdgeID, setSelectedEdgeID] = useState<string | null>(null)
  // React Flow re-subscribes internally whenever this prop's own
  // identity changes and calls it as part of that resync -- an inline
  // arrow function here free-ran on every render, feeding a fresh
  // selection object back into state on each call and looping forever
  // (regression: 60k+ renders/sec, surfaced as a Primer AnchoredOverlay
  // crash elsewhere in the tree once its own effects joined the churn).
  // useCallback keeps this the single stable reference RF requires.
  const onSelectionChange = useCallback<OnSelectionChangeFunc>((params) => {
    onNodeSelectionChange(params)
    setSelectedEdgeID(params.edges[0]?.id ?? null)
  }, [onNodeSelectionChange])

  // Quiet edges (goal 0081 A4): see atlasBuildBoardEdges.ts.
  const edges = useMemo(
    () => buildBoardEdges(arteries, linkKinds, hoveredEdgeID, selectedEdgeID, t, onEdgeDeleteLink, onEdgeChangeKind),
    [arteries, linkKinds, hoveredEdgeID, selectedEdgeID, t, onEdgeDeleteLink, onEdgeChangeKind],
  )

  return { edges, hoveredEdgeID, setHoveredEdgeID, onSelectionChange }
}
