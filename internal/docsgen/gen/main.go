// Writes the generated user-docs artifacts (step reference, llms.txt,
// llms-full.txt) into userdocs/ -- run via `go generate
// ./internal/docsgen`; TestUserDocs_MatchCommitted keeps the committed
// output honest.
package main

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/alicoding/mill/internal/docsgen"
)

func main() {
	root := filepath.Join("..", "..", "userdocs")
	if err := os.WriteFile(filepath.Join(root, "reference", "steps.md"), []byte(docsgen.GenerateStepReference()), 0o600); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	if err := regenerateNounFieldTable(root); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	for name, gen := range map[string]func(string) (string, error){
		"llms.txt":      docsgen.GenerateLLMSTxt,
		"llms-full.txt": docsgen.GenerateLLMSFullTxt,
	} {
		out, err := gen(root)
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		if err := os.WriteFile(filepath.Join(root, name), []byte(out), 0o600); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
	}
}

// regenerateNounFieldTable splices the freshly generated noun
// declaration-field table into extending-the-canvas.md's one marked
// region, leaving the rest of the hand-authored page untouched.
func regenerateNounFieldTable(docsRoot string) error {
	pagePath := filepath.Join(docsRoot, "reference", "extending-the-canvas.md")
	existing, err := os.ReadFile(pagePath) // #nosec G304 -- fixed path under this repo's own userdocs tree
	if err != nil {
		return fmt.Errorf("read extending-the-canvas.md: %w", err)
	}
	frontendAtlasDir := filepath.Join("..", "..", "frontend", "src", "atlas")
	table, err := docsgen.GenerateNounFieldTable(frontendAtlasDir)
	if err != nil {
		return fmt.Errorf("generate noun field table: %w", err)
	}
	updated, err := docsgen.ReplaceMarkedRegion(string(existing), docsgen.NounFieldTableBeginMarker, docsgen.NounFieldTableEndMarker, table)
	if err != nil {
		return fmt.Errorf("splice noun field table into extending-the-canvas.md: %w", err)
	}
	if err := os.WriteFile(pagePath, []byte(updated), 0o600); err != nil { // #nosec G703 -- same fixed path as the read above
		return fmt.Errorf("write extending-the-canvas.md: %w", err)
	}
	return nil
}
