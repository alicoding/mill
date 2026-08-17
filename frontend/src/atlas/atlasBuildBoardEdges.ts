import type { TFunction } from 'i18next'
import type { LinkKind } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import type { ResolvedBoardEdge } from './atlasLinkResolution'
import type { AtlasLinkRFEdge } from './AtlasLinkEdge'
import { linkKindTintToken } from './atlasLinkKindColor'

// The board's own React Flow edges (goal 0081 slice A4's quiet edges,
// LOCKED design §6c) -- pulled out of AtlasBoard.tsx's edges memo
// (architecture.md's 500-line convention) since this is a
// self-contained, closure-free transformation. Two changes from the
// always-on-label original: the stroke is tinted by the artery's own
// (first) link kind instead of one flat accent color, and the label
// renders only when the edge is hovered OR either endpoint card is
// currently flipped -- never unconditionally, so the map reads as
// quiet lines with provenance living on the cards' own slot rows, not
// on the line itself. "Selected" in the LOCKED design's own §3
// vocabulary ("Selecting a card expands it into its authoring state")
// means the flip/glance state, NOT React Flow's own native multi-
// select (AtlasBoard's separate selectedIDs, the marquee/⇧-click
// mechanism "Group into new area" uses) -- conflating the two once
// left a flipped-and-since-reselected card's edges permanently
// unable to go quiet again.
export function buildBoardEdges(
  arteries: ResolvedBoardEdge[],
  linkKinds: LinkKind[],
  hoveredEdgeID: string | null,
  flippedID: string | null,
  t: TFunction<'atlas'>,
): AtlasLinkRFEdge[] {
  const linkKindByID = new Map(linkKinds.map((lk) => [lk.ID, lk]))
  return arteries.map((r): AtlasLinkRFEdge => {
    const endpointActive = flippedID === r.source || flippedID === r.target
    const tintToken = linkKindTintToken(r.linkKindIDs[0])
    return {
      id: r.id,
      source: r.source,
      target: r.target,
      type: 'atlas-link',
      // A single link carries its kind's own label; an aggregated
      // artery labels as its count -- the per-link detail lives one
      // zoom level down and on the card page.
      label: r.count === 1 ? (linkKindByID.get(r.linkKindIDs[0])?.Label ?? '') : t('board.linksChip', { count: r.count }),
      style: { stroke: `var(${tintToken})`, strokeWidth: r.count === 1 ? 1.6 : 2.2, opacity: 0.75 },
      interactionWidth: 8,
      data: { hovered: hoveredEdgeID === r.id || endpointActive },
    }
  })
}
