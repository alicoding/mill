package docsgen

import (
	"fmt"
	"os"
)

// Markers bounding the one generated region inside each "register your
// first X" guide (goal 0231). Both guides quote a real, small,
// self-contained registration file WHOLE rather than a hand-picked
// excerpt: a whole-file splice needs no trimming/selection logic (there
// is nothing to keep in sync beyond "this exact file"), so it stays the
// smallest addition to the docsgen_nouns.go/gen/main.go marked-region
// recipe already proven twice over -- the same ReplaceMarkedRegion call
// every other generated region already uses.
const (
	RegisterCanvasToolQuoteBeginMarker = "<!-- BEGIN GENERATED: frontend/src/atlas/tools/cardTool.ts -->"
	RegisterCanvasToolQuoteEndMarker   = "<!-- END GENERATED -->"
	RegisterCommandQuoteBeginMarker    = "<!-- BEGIN GENERATED: frontend/src/shared/secretsCommands.ts -->"
	RegisterCommandQuoteEndMarker      = "<!-- END GENERATED -->"
)

// GenerateSourceFileQuote reads a real source file whole and wraps it as
// a fenced markdown code block -- the compiling-samples mechanism
// (testing.md's seeds-are-proof rule, generalized to source files that
// aren't seed data): the quote can never hand-drift from the code it
// documents because it IS the code, re-read on every generation.
func GenerateSourceFileQuote(path, lang string) (string, error) {
	raw, err := os.ReadFile(path) // #nosec G304 -- caller-controlled fixed path, never external input
	if err != nil {
		return "", fmt.Errorf("read %s: %w", path, err)
	}
	return fmt.Sprintf("```%s\n%s\n```\n", lang, string(raw)), nil
}
