// Alignment guides while dragging on the board (goal 0161 slice 2).
//
// The comparison is hand-written on purpose: React Flow's own
// helper-lines example is Pro-licensed proprietary source and may not
// be copied or adapted, and no MIT package implements peer alignment
// for React Flow. What IS adopted is the converged pattern every
// canvas tool ships -- six candidates per box (leading edge, center,
// trailing edge on each axis) compared against nearby peers, the
// closest match inside a threshold wins, and the guide line spans the
// aligned pair's combined extent.

export interface Box { id: string; x: number; y: number; w: number; h: number }
export interface Guide { axis: 'x' | 'y'; at: number; from: number; to: number }
export interface GuideResult { guides: Guide[]; snap: { dx: number; dy: number } }

// The threshold is a SCREEN distance, so the gesture feels identical
// at every zoom level; board-space callers convert it with
// guideThreshold(zoom) before calling computeGuides.
export const GUIDE_THRESHOLD_PX = 8

export function guideThreshold(zoom: number): number {
  return GUIDE_THRESHOLD_PX / (zoom > 0 ? zoom : 1)
}

type Anchor = 'start' | 'center' | 'end'
const ANCHORS: readonly Anchor[] = ['start', 'center', 'end']

function anchorOf(box: Box, axis: 'x' | 'y', anchor: Anchor): number {
  const pos = axis === 'x' ? box.x : box.y
  const size = axis === 'x' ? box.w : box.h
  if (anchor === 'start') return pos
  if (anchor === 'end') return pos + size
  return pos + size / 2
}

function centerDistance(a: Box, b: Box): number {
  const dx = (a.x + a.w / 2) - (b.x + b.w / 2)
  const dy = (a.y + a.h / 2) - (b.y + b.h / 2)
  return Math.sqrt(dx * dx + dy * dy)
}

interface Match { delta: number; at: number; peer: Box; centers: number; distance: number }

// Tie-break order, in full: the smaller correction wins; equal
// corrections prefer the match involving fewer CENTER anchors (an
// edge-to-edge alignment reads as the more deliberate one); still
// equal, the nearer peer wins. Without the last two rules a board with
// evenly-sized peers picks an arbitrary line per pointer frame and the
// guide flickers between them.
function beats(candidate: Match, best: Match): boolean {
  const cd = Math.abs(candidate.delta)
  const bd = Math.abs(best.delta)
  if (cd !== bd) return cd < bd
  if (candidate.centers !== best.centers) return candidate.centers < best.centers
  return candidate.distance < best.distance
}

// The nine anchor pairings between one peer and the dragged box on
// one axis, keeping only those inside the threshold.
function matchesFor(dragged: Box, peer: Box, threshold: number, axis: 'x' | 'y'): Match[] {
  const distance = centerDistance(dragged, peer)
  const matches: Match[] = []
  for (const da of ANCHORS) {
    for (const pa of ANCHORS) {
      const at = anchorOf(peer, axis, pa)
      const delta = at - anchorOf(dragged, axis, da)
      if (Math.abs(delta) > threshold) continue
      matches.push({ delta, at, peer, centers: (da === 'center' ? 1 : 0) + (pa === 'center' ? 1 : 0), distance })
    }
  }
  return matches
}

function bestOnAxis(dragged: Box, peers: Box[], threshold: number, axis: 'x' | 'y'): Match | null {
  let best: Match | null = null
  for (const peer of peers) {
    if (peer.id === dragged.id) continue
    for (const candidate of matchesFor(dragged, peer, threshold, axis)) {
      if (best === null || beats(candidate, best)) best = candidate
    }
  }
  return best
}

// `snap` is the correction to ADD to the dragged box's position to sit
// exactly on the matched lines; the guides are measured from the
// dragged box AFTER that correction, so the drawn line and the
// resting position agree to the pixel.
export function computeGuides(dragged: Box, peers: Box[], threshold: number): GuideResult {
  const x = bestOnAxis(dragged, peers, threshold, 'x')
  const y = bestOnAxis(dragged, peers, threshold, 'y')
  const snap = { dx: x?.delta ?? 0, dy: y?.delta ?? 0 }
  const moved: Box = { ...dragged, x: dragged.x + snap.dx, y: dragged.y + snap.dy }
  const guides: Guide[] = []
  if (x) {
    guides.push({
      axis: 'x',
      at: x.at,
      from: Math.min(moved.y, x.peer.y),
      to: Math.max(moved.y + moved.h, x.peer.y + x.peer.h),
    })
  }
  if (y) {
    guides.push({
      axis: 'y',
      at: y.at,
      from: Math.min(moved.x, y.peer.x),
      to: Math.max(moved.x + moved.w, y.peer.x + y.peer.w),
    })
  }
  return { guides, snap }
}

export function sameGuides(a: Guide[], b: Guide[]): boolean {
  if (a.length !== b.length) return false
  return a.every((g, i) => {
    const o = b[i]
    return o !== undefined && g.axis === o.axis && g.at === o.at && g.from === o.from && g.to === o.to
  })
}

export interface GuideChannel {
  subscribe: (listener: () => void) => () => void
  snapshot: () => Guide[]
  publish: (guides: Guide[]) => void
}

const NO_GUIDES: Guide[] = []

// The guides reach their overlay through this channel rather than
// state in the drag hook (goal 0161 slice 1's law): a per-pointer-frame
// setState in the hook re-renders the whole board component, which is
// the lag class slice 1 removed. useSyncExternalStore re-renders on
// every new snapshot REFERENCE, so publish keeps the previous array
// whenever the guides are unchanged -- a drag frame that moves without
// changing the matched lines costs nothing.
export function createGuideChannel(): GuideChannel {
  let current: Guide[] = NO_GUIDES
  const listeners = new Set<() => void>()
  return {
    subscribe: (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    snapshot: () => current,
    publish: (next) => {
      if (sameGuides(current, next)) return
      current = next.length === 0 ? NO_GUIDES : next
      for (const listener of listeners) listener()
    },
  }
}
