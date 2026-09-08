import type { BrowseEntry } from '../../bindings/github.com/alicoding/mill/internal/services/pluginsvc/models'
import { fuzzyMatches } from '../shared/fuzzyFilter'

// The Browse tab's pure query+kind filter (goal 0366 Class B):
// co-located with its only caller (ExtensionsBrowseTab.tsx). Query
// matching tolerates a typo the way the command palette does, via the
// shared fuzzysort call; kind chips stay an exact-set filter.
export function filterBrowseEntries(entries: BrowseEntry[], query: string, kinds: string[]): BrowseEntry[] {
  const q = query.trim().toLowerCase()
  return entries.filter((e) => {
    const matchesQuery = q === '' || fuzzyMatches(q, (e.Name || e.ID).toLowerCase()) || fuzzyMatches(q, (e.Description ?? '').toLowerCase())
    const matchesKind = kinds.length === 0 || kinds.some((kind) => (e.Kinds ?? []).includes(kind))
    return matchesQuery && matchesKind
  })
}
