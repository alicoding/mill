package docsgen

import (
	"os"
	"path/filepath"
	"testing"
)

// Same tfplugindocs shape as TestExtendingCanvasPage_NounFieldTableMatchesCommitted,
// scoped to the one generated region inside the otherwise hand-authored
// userdocs/reference/commands.md (goal 0231). Fix a failure with
// `go generate ./internal/docsgen`.
func TestCommandsPage_TableMatchesCommitted(t *testing.T) {
	pagePath := filepath.Join("..", "..", "userdocs", "reference", "commands.md")
	committed, err := os.ReadFile(pagePath) // #nosec G304 -- fixed path under this repo's own userdocs tree
	if err != nil {
		t.Fatalf("read commands.md: %v", err)
	}
	frontendSharedDir := filepath.Join("..", "..", "frontend", "src", "shared")
	wantTable, err := GenerateCommandTable(frontendSharedDir)
	if err != nil {
		t.Fatalf("generate command table: %v", err)
	}
	want, err := ReplaceMarkedRegion(string(committed), CommandTableBeginMarker, CommandTableEndMarker, wantTable)
	if err != nil {
		t.Fatalf("splice generated table into commands.md: %v", err)
	}
	if string(committed) != want {
		t.Errorf("commands.md's generated table is stale -- run `go generate ./internal/docsgen` and commit the result")
	}
}
