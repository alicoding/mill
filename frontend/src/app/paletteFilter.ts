import { fuzzyScore } from '../shared/fuzzyFilter'

// Query-matching for the ⌘K command palette
// (docs/goals/0015-summon-quick-invoke.md; goal 0272 supersedes its
// substring-only matching). Two tiers, both stable:
//
// 1. SUBSTRING tier -- the original prefix-then-contains partition,
//    unchanged: an exact/near-exact fragment (typing a workflow's
//    first word) always outranks everything else, and relative order
//    within each bucket is the caller's own (registry order for
//    commands, alphabetical for workflows, open-order for tabs).
// 2. FUZZY tier -- entries with no substring hit fall through to
//    fuzzysort's subsequence scoring (the fzf/VSCode-shaped matcher
//    command palettes converged on), so "ows" still finds "Open
//    Workflow Settings". Ranked by score, original order breaking
//    ties, and always AFTER every substring hit -- fuzzy never
//    shadows an exact fragment.
//
// This tiering (prefix/contains partition + keyword aliases) is the
// palette's own and stays co-located with its only caller
// (app/CommandPalette.tsx) -- .claude/rules/frontend.md's own
// placement rule. The underlying `fuzzysort` call + scoring floor it
// falls back to is shared/fuzzyFilter.ts (goal 0366 Class B), reused
// by every other picker/search surface so none re-implements it.
// Exported + unit-tested per .claude/rules/testing.md.

export interface PaletteSearchable {
  // Precomputed, already-lowercased haystack (e.g. `${label} ${id}`)
  // -- built once per entry at render time, not re-derived per
  // keystroke inside this function.
  searchText: string
  // Aliases that rank as prefix matches (Command.keywords).
  keywords?: string[]
}

// Empty/whitespace-only query returns every entry, unranked (the
// palette's own "browse everything" state before typing anything).
export function filterPaletteEntries<T extends PaletteSearchable>(entries: T[], query: string): T[] {
  const q = query.trim().toLowerCase()
  if (!q) return entries
  const prefixMatches: T[] = []
  const containsMatches: T[] = []
  const fuzzyCandidates: { entry: T; score: number; index: number }[] = []
  entries.forEach((entry, index) => {
    const at = entry.searchText.indexOf(q)
    if (at === 0 || entry.keywords?.some((k) => k.startsWith(q))) {
      prefixMatches.push(entry)
      return
    }
    if (at > 0) {
      containsMatches.push(entry)
      return
    }
    const score = fuzzyScore(q, entry.searchText)
    if (score !== undefined) {
      fuzzyCandidates.push({ entry, score, index })
    }
  })
  fuzzyCandidates.sort((a, b) => b.score - a.score || a.index - b.index)
  return [...prefixMatches, ...containsMatches, ...fuzzyCandidates.map((c) => c.entry)]
}
