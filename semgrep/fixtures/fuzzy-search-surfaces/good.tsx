// Fixture for semgrep/fuzzy-search-surfaces.yml's negative probe (goal
// 0366): a picker-shaped surface ranking through the shared fuzzysort
// helper instead of a plain substring test. Flat file, never imported
// -- scripts/check-fuzzy-search-surfaces-selftest.sh copies it into a
// throwaway tree under a *Picker*.tsx filename before scanning it.
import { fuzzyMatches } from '../shared/fuzzyFilter'

export function filterRows(rows: { label: string }[], query: string) {
  const q = query.trim().toLowerCase()
  return rows.filter((r) => fuzzyMatches(q, r.label.toLowerCase()))
}
