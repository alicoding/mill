import { useCallback, useMemo, useState } from 'react'
import type { TFunction } from 'i18next'
import type { OnSelectionChangeFunc } from '@xyflow/react'
import type { Card, Kind, LinkKind } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import type { Edge } from '@xyflow/react'
import type { ResolvedBoardEdge } from './atlasLinkResolution'
import { buildBoardEdges } from './atlasBuildBoardEdges'

// The board's own edge hover/selection state (goal 0124 slice 2) plus
// the RF-ready edges it feeds -- split out of AtlasBoard.tsx at the
// 500-line seam since this is a self-contained concern: which edge is
// hovered/pinned drives the hover chip's own visibility, and both
// states are threaded straight into buildBoardEdges.
export function useAtlasEdgeInteraction({
  arteries, linkKinds, allCards, renderedIDs, kinds, t, onEdgeDeleteLink, onEdgeChangeKind, onNodeSelectionChange,
}: {
  arteries: ResolvedBoardEdge[]
  linkKinds: LinkKind[]
  // Every card + the ids actually rendered as nodes (top level AND
  // one-deep frame previews), for DERIVED cardref edges (goal 0152
  // slice 2): a card whose cardref field names another rendered card
  // draws a dashed, non-interactive edge labeled by the field --
  // derived from the field value on every render, never a stored
  // Link, so it can't drift from the data. Both endpoints must be
  // rendered nodes (no artery aggregation to an ancestor -- recorded
  // limitation in the goal file).
  allCards: Card[]
  renderedIDs: Set<string>
  kinds: Kind[]
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
  const edges = useMemo(() => {
    const built: Edge[] = buildBoardEdges(arteries, linkKinds, hoveredEdgeID, selectedEdgeID, t, onEdgeDeleteLink, onEdgeChangeKind)
    const kindByID = new Map(kinds.map((k) => [k.ID, k]))
    for (const card of allCards) {
      if (!renderedIDs.has(card.ID)) continue
      for (const f of kindByID.get(card.KindID)?.Fields ?? []) {
        if (f.Type !== 'cardref') continue
        const target = card.Fields?.[f.Key] ?? ''
        if (!target || !renderedIDs.has(target) || target === card.ID) continue
        built.push({
          id: `cardref-${card.ID}-${f.Key}`,
          source: card.ID,
          target,
          label: f.Label || f.Key,
          selectable: false,
          focusable: false,
          style: { stroke: 'var(--borderColor-emphasis)', strokeWidth: 1.2, strokeDasharray: '4 3', opacity: 0.7 },
          labelStyle: { fill: 'var(--fgColor-muted)', fontSize: 10 },
          labelBgStyle: { fill: 'var(--bgColor-default)' },
        })
      }
    }
    return built
  }, [arteries, linkKinds, allCards, renderedIDs, kinds, hoveredEdgeID, selectedEdgeID, t, onEdgeDeleteLink, onEdgeChangeKind])

  return { edges, hoveredEdgeID, setHoveredEdgeID, onSelectionChange }
}
