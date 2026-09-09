import fuzzysort from 'fuzzysort'

// The one `fuzzysort` call every picker/search surface ranks through
// (goal 0366 Class B) -- extracted from the command palette's own
// filter (./paletteFilter.ts, goal 0272, promoted from app/ to shared/
// in goal 0412 S2), which stays the caller for its own tiered
// (prefix/contains/fuzzy) ranking. A surface with no tiering of its
// own uses fuzzyMatches below.

// The scoring floor below which a fuzzysort subsequence hit is noise,
// not a match -- admits word-initial abbreviations ("ows") while
// rejecting scattered-letter coincidences. Tuned against
// paletteFilter.test.ts's pinned cases; shared so every surface has
// the same typo tolerance the palette established.
export const FUZZY_THRESHOLD = 0.3

// fuzzyScore: normalized 0..1 score (1 = exact) for `query` against
// `text`, or undefined when it isn't a subsequence of text or scores
// below FUZZY_THRESHOLD.
export function fuzzyScore(query: string, text: string): number | undefined {
  const result = fuzzysort.single(query, text)
  if (!result || result.score < FUZZY_THRESHOLD) return undefined
  return result.score
}

// fuzzyMatches: substring-or-fuzzy membership test for surfaces that
// filter a list without ranking it (a superset of plain
// `.includes()`: every prior substring match still matches, plus a
// typo'd query that only scores as a fuzzysort subsequence). An empty
// query matches everything.
export function fuzzyMatches(query: string, text: string): boolean {
  if (!query) return true
  if (text.includes(query)) return true
  return fuzzyScore(query, text) !== undefined
}
