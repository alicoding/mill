package docsgen

import (
	"os"
	"path/filepath"
	"testing"
)

// Same tfplugindocs shape as TestExtendingCanvasPage_NounFieldTableMatchesCommitted
// and TestCommandsPage_TableMatchesCommitted, scoped to each "register
// your first X" guide's one marked region (goal 0231). Fix a failure
// with `go generate ./internal/docsgen`.
func TestRegisterAGuidePage_SourceQuoteMatchesCommitted(t *testing.T) {
	cases := []struct {
		name                   string
		pageRel, sourceRel     string
		beginMarker, endMarker string
	}{
		{
			name:        "register-a-canvas-tool.md quotes cardTool.ts",
			pageRel:     filepath.Join("reference", "register-a-canvas-tool.md"),
			sourceRel:   filepath.Join("atlas", "tools", "cardTool.ts"),
			beginMarker: RegisterCanvasToolQuoteBeginMarker,
			endMarker:   RegisterCanvasToolQuoteEndMarker,
		},
		{
			name:        "register-a-command.md quotes secretsCommands.ts",
			pageRel:     filepath.Join("reference", "register-a-command.md"),
			sourceRel:   filepath.Join("shared", "secretsCommands.ts"),
			beginMarker: RegisterCommandQuoteBeginMarker,
			endMarker:   RegisterCommandQuoteEndMarker,
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			pagePath := filepath.Join("..", "..", "userdocs", c.pageRel)
			committed, err := os.ReadFile(pagePath) // #nosec G304 -- fixed path under this repo's own userdocs tree
			if err != nil {
				t.Fatalf("read %s: %v", c.pageRel, err)
			}
			sourcePath := filepath.Join("..", "..", "frontend", "src", c.sourceRel)
			wantQuote, err := GenerateSourceFileQuote(sourcePath, "ts")
			if err != nil {
				t.Fatalf("generate source quote: %v", err)
			}
			want, err := ReplaceMarkedRegion(string(committed), c.beginMarker, c.endMarker, wantQuote)
			if err != nil {
				t.Fatalf("splice source quote into %s: %v", c.pageRel, err)
			}
			if string(committed) != want {
				t.Errorf("%s's quoted source is stale -- run `go generate ./internal/docsgen` and commit the result", c.pageRel)
			}
		})
	}
}
