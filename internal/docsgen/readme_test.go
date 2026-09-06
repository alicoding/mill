package docsgen

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/alicoding/mill/internal/services/servicetest"
)

// The tfplugindocs shape TestUserDocs_MatchCommitted established,
// applied to the README's one generated region: the committed
// inventory must equal what the live registries generate. Fix a
// failure with `go generate ./internal/docsgen`.
func TestREADME_MatchesGenerated(t *testing.T) {
	root := filepath.Join("..", "..")
	committed, err := os.ReadFile(filepath.Join(root, "README.md")) // #nosec G304 -- fixed path at this repo's own root
	if err != nil {
		t.Fatalf("read README.md: %v", err)
	}
	inventory, err := GenerateReadmeInventory(filepath.Join(root, "userdocs"), servicetest.NewFakeStore())
	if err != nil {
		t.Fatalf("generate inventory: %v", err)
	}
	want, err := ReplaceMarkedRegion(string(committed), ReadmeInventoryBeginMarker, ReadmeInventoryEndMarker, inventory)
	if err != nil {
		t.Fatalf("splice inventory into README.md: %v", err)
	}
	if string(committed) != want {
		t.Errorf("README.md's inventory is stale -- run `go generate ./internal/docsgen` and commit the result")
	}
}

func TestCutSentence(t *testing.T) {
	cases := map[string]string{
		"One. Two.":                 "One.",
		"Runs v1.2 nightly. Then":   "Runs v1.2 nightly.",
		"No terminator at all":      "No terminator at all",
		"Ends with a question? Yes": "Ends with a question?",
	}
	for in, want := range cases {
		if got := cutSentence(in); got != want {
			t.Errorf("cutSentence(%q) = %q, want %q", in, got, want)
		}
	}
}
