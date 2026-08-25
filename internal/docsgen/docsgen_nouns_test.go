package docsgen

import (
	"os"
	"path/filepath"
	"testing"
)

// Same tfplugindocs shape as TestUserDocs_MatchCommitted, scoped to
// the one generated region inside an otherwise hand-authored page
// (goal 0211's "Extending the canvas" contract page mixes reviewed
// prose with a generated table, unlike steps.md/llms.txt which are
// generated wholesale). Fix a failure with
// `go generate ./internal/docsgen`.
func TestExtendingCanvasPage_NounFieldTableMatchesCommitted(t *testing.T) {
	pagePath := filepath.Join("..", "..", "userdocs", "reference", "extending-the-canvas.md")
	committed, err := os.ReadFile(pagePath) // #nosec G304 -- fixed path under this repo's own userdocs tree
	if err != nil {
		t.Fatalf("read extending-the-canvas.md: %v", err)
	}
	frontendAtlasDir := filepath.Join("..", "..", "frontend", "src", "atlas")
	wantTable, err := GenerateNounFieldTable(frontendAtlasDir)
	if err != nil {
		t.Fatalf("generate noun field table: %v", err)
	}
	want, err := ReplaceMarkedRegion(string(committed), NounFieldTableBeginMarker, NounFieldTableEndMarker, wantTable)
	if err != nil {
		t.Fatalf("splice generated table into committed page: %v", err)
	}
	if string(committed) != want {
		t.Errorf("extending-the-canvas.md's generated table is stale -- run `go generate ./internal/docsgen` and commit the result")
	}
}
