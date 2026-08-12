package fuzzymatch

import "testing"

func TestSearch_ExactMatch_ScoresOne(t *testing.T) {
	got := Search("France", []string{"France"}, 0.5)
	if len(got) != 1 || got[0].Value != "France" || got[0].Score != 1.0 {
		t.Fatalf("Search(exact) = %+v, want one Match{France, 1.0}", got)
	}
}

func TestSearch_Typo_MatchesAboveThreshold(t *testing.T) {
	// One transposition -- Damerau-Levenshtein's whole reason for being
	// over plain Levenshtein (which would count it as two edits).
	got := Search("Fracne", []string{"France"}, 0.7)
	if len(got) != 1 || got[0].Value != "France" {
		t.Fatalf("Search(typo) = %+v, want a match against France", got)
	}
	if got[0].Score <= 0 || got[0].Score >= 1.0 {
		t.Errorf("Search(typo) score = %v, want strictly between 0 and 1", got[0].Score)
	}
}

func TestSearch_BelowThreshold_Excluded(t *testing.T) {
	got := Search("Zzzzzz", []string{"France"}, 0.9)
	if len(got) != 0 {
		t.Errorf("Search(dissimilar, high threshold) = %+v, want no matches", got)
	}
}

func TestSearch_MultipleCandidates_SortedBestFirst(t *testing.T) {
	got := Search("France", []string{"Franc", "Francia", "Germany"}, 0.3)
	if len(got) < 2 {
		t.Fatalf("Search = %+v, want at least 2 matches", got)
	}
	for i := 1; i < len(got); i++ {
		if got[i-1].Score < got[i].Score {
			t.Errorf("Search results not sorted best-first: %+v", got)
		}
	}
}

func TestSearch_EmptyCandidates_ReturnsEmpty(t *testing.T) {
	if got := Search("France", nil, 0.5); len(got) != 0 {
		t.Errorf("Search(no candidates) = %+v, want empty", got)
	}
}
