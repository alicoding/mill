import type { Node } from '@xyflow/react'

// carryMeasured keeps a node's measured size across a wholesale rebuild
// of the board's node array. React Flow reads `measured` from the node
// object it is handed; a fresh object without it, for a node that
// declares no height (a sticky grows with its text), counts as
// unmeasured and is rendered `visibility: hidden` until the resize
// observer reports again. Chromium moves a caret inside hidden content
// to the editing host's start, so a rebuild mid-typing lost keystrokes
// to the top of the note (goal 0316). Explicit dimensions on the new
// node win; a node with no previous measurement stays as built.
export function carryMeasured<N extends Node>(previous: readonly N[], next: readonly N[]): N[] {
  const measured = new Map<string, N['measured']>()
  for (const n of previous) if (n.measured) measured.set(n.id, n.measured)
  return next.map((n) => (n.measured || !measured.has(n.id) ? n : { ...n, measured: measured.get(n.id) }))
}
