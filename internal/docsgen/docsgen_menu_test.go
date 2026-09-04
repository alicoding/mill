package docsgen

import (
	"os"
	"path/filepath"
	"testing"
)

// The committed menu-bar page's generated region must match the
// declaration it is derived from -- same freshness shape as
// TestCommandsPage_TableMatchesCommitted. Fix a failure with
// `go generate ./internal/docsgen`.
func TestMenuBarPage_TableMatchesCommitted(t *testing.T) {
	pagePath := filepath.Join("..", "..", "userdocs", "reference", "menu-bar.md")
	committed, err := os.ReadFile(pagePath) // #nosec G304 -- fixed path under this repo's own userdocs tree
	if err != nil {
		t.Fatalf("read menu-bar.md: %v", err)
	}
	wantTable, err := GenerateMenuTable(filepath.Join("..", "..", "frontend", "src", "shared"))
	if err != nil {
		t.Fatalf("generate menu table: %v", err)
	}
	want, err := ReplaceMarkedRegion(string(committed), MenuTableBeginMarker, MenuTableEndMarker, wantTable)
	if err != nil {
		t.Fatalf("splice generated table into menu-bar.md: %v", err)
	}
	if string(committed) != want {
		t.Errorf("menu-bar.md's generated table is stale -- run `go generate ./internal/docsgen` and commit the result")
	}
}
