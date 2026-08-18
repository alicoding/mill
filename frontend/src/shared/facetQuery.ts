// Faceted search grammar (goal 0086): a typed inline qualifier
// `<label>: <text>` at a search query's start, shared by the command
// palette, the Quick Panel, and the Atlas jump dialog so all three
// scope the exact same way. Precedent survey (goal 0086's DoR) found
// no surveyed launcher uses a click/Tab-to-accept facet in its primary
// search -- the convergence is this typed qualifier, where typing IS
// the acceptance and the token stays visible in the input as its own
// scope indicator.

export interface FacetVocabEntry {
  // Opaque to this module -- the caller's own scope identifier (a
  // group id, an entity-type key, an Atlas Kind ID, ...), returned
  // unchanged in a match so the caller can filter its own entries by
  // it.
  key: string
  // Displayed and matched exactly as given (matching is
  // case-insensitive, but the label's own stored casing is what a
  // suggestion chip renders).
  label: string
  aliases?: string[]
}

export interface FacetQuery {
  scopeKey?: string
  text: string
}

// parseFacetQuery: a whole vocabulary label (or alias) immediately
// before the query's FIRST colon, matched case-insensitively,
// activates that entry's scope and consumes the token -- everything
// after the colon (leading whitespace trimmed) becomes `text`. A
// colon anywhere else in the query (inside `text`, because the label
// portion didn't match anything) is left alone: only the substring
// before the first colon is ever checked against the vocabulary, so a
// non-matching prefix falls through to "no scope, text = the whole
// query" rather than misparsing. Multi-word labels ("mcp server")
// match only when typed in full, never a partial word.
export function parseFacetQuery(query: string, vocabulary: FacetVocabEntry[]): FacetQuery {
  const colonIndex = query.indexOf(':')
  if (colonIndex === -1) return { text: query }

  const token = query.slice(0, colonIndex).trim().toLowerCase()
  if (!token) return { text: query }

  const match = vocabulary.find(
    (entry) => entry.label.toLowerCase() === token || (entry.aliases ?? []).some((alias) => alias.toLowerCase() === token),
  )
  if (!match) return { text: query }

  return { scopeKey: match.key, text: query.slice(colonIndex + 1).trimStart() }
}

// matchFacetSuggestions: the suggestion-chip row's own source list --
// every vocabulary entry whose label starts with the query's first
// word, capped at `max`. Only meaningful before a scope is active (the
// caller checks that); once a query already has a matching label+colon
// at its start, parseFacetQuery already resolved it and there's
// nothing left to suggest.
export function matchFacetSuggestions(query: string, vocabulary: FacetVocabEntry[], max = 5): FacetVocabEntry[] {
  const firstWord = query.trimStart().split(/\s+/)[0]?.toLowerCase()
  if (!firstWord) return []
  return vocabulary.filter((entry) => entry.label.toLowerCase().startsWith(firstWord)).slice(0, max)
}
