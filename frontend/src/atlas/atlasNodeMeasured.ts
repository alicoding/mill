import type { Node } from '@xyflow/react'

// carryMeasured keeps a node's measured size across a wholesale rebuild
// of the board's node array. React Flow reads `measured` from the node
// object it is handed; a fresh object without it, for a node that
// declares no height (a sticky grows with its text), counts as
// unmeasured and is rendered `visibility: hidden` until the resize
// observer reports again. Chromium moves a caret inside hidden content
// to the editing host's start, so a rebuild mid-typing lost keystrokes
// to the top of the note (goal 0316).
//
// The carry is narrow on purpose: only a node with no declared height
// (one that declares both dimensions is never hidden), only when the
// rebuilt node is the same thing it was (type, parent, declared
// dimensions unchanged -- a re-rooted card is a different tile with the
// same id, and a stale size fed the viewport fit a wrong frame), and
// never over a measurement the new node already carries.
export function carryMeasured<N extends Node>(previous: readonly N[], next: readonly N[]): N[] {
  const prior = new Map<string, N>()
  for (const n of previous) if (n.measured) prior.set(n.id, n)
  return next.map((n) => {
    if (n.measured || (n.width !== undefined && n.height !== undefined)) return n
    const p = prior.get(n.id)
    if (!p || p.type !== n.type || p.parentId !== n.parentId || p.width !== n.width || p.height !== n.height) return n
    return { ...n, measured: p.measured }
  })
}
