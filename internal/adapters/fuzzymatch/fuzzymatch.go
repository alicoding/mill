// Package fuzzymatch wraps github.com/hbollon/go-edlib (MIT, actively
// maintained, zero external dependencies -- confirmed directly against
// its go.mod) behind Mill's own names, the same
// internal/adapters/expression precedent (.claude/rules/backend.md):
// keep a commodity matching library behind a small adapter so a
// future swap never touches domain code
// (internal/domain/composition/listsearch.go).
//
// Default algorithm is Damerau-Levenshtein -- docs/goals/0011-lists-
// maturation.md's own decided default, from industry research: the
// most explainable edit-distance algorithm (a human can reason about
// "N character edits including one transposition"), and the default
// both Elasticsearch's fuzzy query and OpenRefine's own key-collision
// clustering ship with. A per-column Jaro-Winkler override (its
// Census name-matching origin makes it a better fit for a "Name"-typed
// column specifically) is real future work, deliberately deferred --
// it needs a typed Name column subtype that doesn't exist yet.
//
// Exact-match lookups never route through this package at all --
// plain equality stays plain equality
// (internal/domain/composition/listsearch.go's own exact branch).
package fuzzymatch

import (
	"sort"

	edlib "github.com/hbollon/go-edlib"
)

// Match is one candidate string that met the similarity threshold,
// with its similarity score (0..1, edlib's own normalized range: 1.0
// is an exact match, 0.0 is completely dissimilar).
type Match struct {
	Value string
	Score float64
}

// Search returns every candidate whose Damerau-Levenshtein similarity
// to query is >= threshold (0..1), sorted best-match-first (ties keep
// candidates' original relative order). A candidate edlib can't score
// (its own StringsSimilarity only errors on an empty algorithm-input
// edge case) is skipped rather than failing the whole search --
// there's no reasonable per-candidate error to surface to a workflow
// author here, and skipping degrades to "that one candidate never
// matches" rather than aborting every other candidate's real result.
func Search(query string, candidates []string, threshold float64) []Match {
	var out []Match
	for _, c := range candidates {
		sim, err := edlib.StringsSimilarity(query, c, edlib.DamerauLevenshtein)
		if err != nil {
			continue
		}
		if float64(sim) >= threshold {
			out = append(out, Match{Value: c, Score: float64(sim)})
		}
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].Score > out[j].Score })
	return out
}
