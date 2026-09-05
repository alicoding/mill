package capabilities

import (
	"os"
	"path/filepath"
	"testing"
)

// repoRoot resolves from this test file's own package directory
// (internal/domain/capabilities) up to the repo root, since go test runs
// with the package directory as its working directory.
const repoRoot = "../../.."

func TestList_NoEmptyIDsOrLabels(t *testing.T) {
	for _, c := range List() {
		if c.ID == "" {
			t.Errorf("capability %+v has an empty ID", c)
		}
		if c.Label == "" {
			t.Errorf("capability %q has an empty Label", c.ID)
		}
		if c.SpecSection == "" {
			t.Errorf("capability %q has an empty SpecSection", c.ID)
		}
	}
}

func TestList_IDsAreUnique(t *testing.T) {
	seen := make(map[string]bool)
	for _, c := range List() {
		if seen[c.ID] {
			t.Errorf("duplicate capability ID %q", c.ID)
		}
		seen[c.ID] = true
	}
}

// The real regression guard this package exists for: EditorPath must
// point at a file that actually exists today, never an aspirational
// package that hasn't been built yet -- catching that here at test time
// beats a user clicking a dead "jump to source" link.
func TestList_EditorPathsExist(t *testing.T) {
	for _, c := range List() {
		if c.EditorPath == "" {
			continue
		}
		full := filepath.Join(repoRoot, c.EditorPath)
		if _, err := os.Stat(full); err != nil {
			t.Errorf("capability %q has EditorPath %q, which doesn't resolve to a real file: %v", c.ID, c.EditorPath, err)
		}
	}
}

func TestList_PlaceholderCapabilitiesHaveNoDirectView(t *testing.T) {
	for _, c := range List() {
		if c.View == ViewPlaceholder {
			continue
		}
		if c.View != ViewHome && c.View != ViewActivity && c.View != ViewComposition && c.View != ViewConfigure && c.View != ViewAtlas && c.View != ViewReview && c.View != ViewDocs && c.View != ViewSecrets && c.View != ViewExtensions {
			t.Errorf("capability %q has unrecognized View %q", c.ID, c.View)
		}
	}
}
