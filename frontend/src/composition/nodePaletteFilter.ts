import type { NodeType, Workflow } from '../../bindings/github.com/alicoding/mill/internal/domain/composition/models'
import { fuzzyMatches } from '../shared/fuzzyFilter'
import { shortLabel } from '../shared/paletteGroups'

// The palette search box's pure matching (goal 0366 Class B):
// co-located with its only caller (NodePalette.tsx), same placement
// rule paletteFilter.ts documents. Matches both the shortened palette
// label AND the full nt.Label (a query can match a declared/legacy
// step's colon-style label even though the palette itself only shows
// the shortened form), and now tolerates a typo the way the command
// palette does, via the shared fuzzysort call.
export function nodeTypeMatchesQuery(nt: NodeType, normalizedQuery: string): boolean {
  if (!normalizedQuery) return true
  return fuzzyMatches(normalizedQuery, nt.Label.toLowerCase()) || fuzzyMatches(normalizedQuery, shortLabel(nt).toLowerCase())
}

export function exampleMatches(workflows: Workflow[] | null, normalizedQuery: string): Workflow[] {
  if (!workflows || !normalizedQuery) return []
  return workflows
    .filter((w) => fuzzyMatches(normalizedQuery, (w.Label + ' ' + w.Description).toLowerCase()))
    .slice(0, 3)
}
