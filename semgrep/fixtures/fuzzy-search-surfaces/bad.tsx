// Fixture for semgrep/fuzzy-search-surfaces.yml's positive probe (goal
// 0366): a picker-shaped surface filtering with a plain
// .toLowerCase().includes(...) substring test instead of the shared
// fuzzysort helper. Flat file, never imported --
// scripts/check-fuzzy-search-surfaces-selftest.sh copies it into a
// throwaway tree under a *Picker*.tsx filename before scanning it.
export function filterRows(rows: { label: string }[], query: string) {
  const q = query.trim().toLowerCase()
  return rows.filter((r) => r.label.toLowerCase().includes(q))
}
