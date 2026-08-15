package atlassvc

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// seededConceptNames are the exact seeded example names ADR-0038
// Decision 2 forbids as a Go identifier or string literal anywhere
// outside a seed file -- the concrete acceptance-checkable list
// docs/goals/0061 names ("none of those names exist anywhere in Go/TS
// source as constants... seeded examples only in seed files").
var seededConceptNames = []string{"Topic", "Contact", "Document", "relates to", "My space"}

// nonSeedGoFiles walks dir's *.go files (excluding _test.go, which may
// legitimately reference a seeded name to test the seed itself) and
// returns every one whose basename isn't a recognized seed file --
// internal/domain/atlas/builtin.go and any internal/services/atlassvc
// file with "_builtin"/"_seed" in its name, the only places ADR-0038
// permits a seeded concept name to appear.
func nonSeedGoFiles(t *testing.T, dir string) []string {
	t.Helper()
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatalf("ReadDir(%q): %v", dir, err)
	}
	var out []string
	for _, e := range entries {
		name := e.Name()
		if e.IsDir() || !strings.HasSuffix(name, ".go") {
			continue
		}
		if strings.HasSuffix(name, "_test.go") {
			continue
		}
		if name == "builtin.go" || strings.Contains(name, "_builtin") || strings.Contains(name, "_seed") {
			continue
		}
		out = append(out, filepath.Join(dir, name))
	}
	return out
}

// TestAtlasNoHardcodedConcepts is the grep-checkable tripwire
// docs/goals/0061's acceptance criterion asks for: no seeded card-kind
// or link-kind NAME appears anywhere in this package or
// internal/domain/atlas's non-seed source, proving ADR-0038 Decision
// 2's "nothing conceptual is hardcoded" by construction rather than by
// code review alone.
//
// Limits (deliberate, not a gap to close later): this only catches the
// exact seeded example strings named in docs/goals/0061's acceptance
// criterion -- a DIFFERENT hardcoded concept (one this slice never
// seeded, or a future seed's name) would not trip it, and a match
// inside a comment or an unrelated string that happens to contain one
// of these words (e.g. "the document says...") would be a false
// positive worth reading before assuming a real violation. It is a
// tripwire for regression on the known seeded names, not a general
// static analyzer for "did someone hardcode a concept."
func TestAtlasNoHardcodedConcepts(t *testing.T) {
	dirs := []string{
		filepath.Join("..", "..", "domain", "atlas"),
		".",
	}
	for _, dir := range dirs {
		for _, path := range nonSeedGoFiles(t, dir) {
			data, err := os.ReadFile(path) //nolint:gosec // repo-relative source path built from os.ReadDir's own listing, not user input
			if err != nil {
				t.Fatalf("ReadFile(%q): %v", path, err)
			}
			content := string(data)
			for _, name := range seededConceptNames {
				if strings.Contains(content, name) {
					t.Errorf("%s contains seeded concept name %q outside a seed file -- ADR-0038 Decision 2 requires every card-kind/link-kind name to live only in a builtin/seed file", path, name)
				}
			}
		}
	}
}
