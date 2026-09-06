// Writes the generated user-docs artifacts (step reference, llms.txt,
// llms-full.txt) into userdocs/ and the README's inventory block --
// run via `go generate ./internal/docsgen`; TestUserDocs_MatchCommitted
// and TestREADME_MatchesGenerated keep the committed output honest.
package main

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/alicoding/mill/internal/docsgen"
	"github.com/alicoding/mill/internal/services/servicetest"
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
	if err := regenerateCommandTable(root); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	if err := regenerateMenuTable(root); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	if err := regenerateGuideQuotes(root); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	if err := regenerateMaturityLedger(root); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	if err := regenerateReadmeInventory(root); err != nil {
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

// regenerateCommandTable splices the freshly generated command registry
// table into commands.md's one marked region, leaving the rest of the
// hand-authored page untouched -- same shape as regenerateNounFieldTable
// above.
func regenerateCommandTable(docsRoot string) error {
	pagePath := filepath.Join(docsRoot, "reference", "commands.md")
	existing, err := os.ReadFile(pagePath) // #nosec G304 -- fixed path under this repo's own userdocs tree
	if err != nil {
		return fmt.Errorf("read commands.md: %w", err)
	}
	frontendSharedDir := filepath.Join("..", "..", "frontend", "src", "shared")
	table, err := docsgen.GenerateCommandTable(frontendSharedDir)
	if err != nil {
		return fmt.Errorf("generate command table: %w", err)
	}
	updated, err := docsgen.ReplaceMarkedRegion(string(existing), docsgen.CommandTableBeginMarker, docsgen.CommandTableEndMarker, table)
	if err != nil {
		return fmt.Errorf("splice command table into commands.md: %w", err)
	}
	if err := os.WriteFile(pagePath, []byte(updated), 0o600); err != nil { // #nosec G703 -- same fixed path as the read above
		return fmt.Errorf("write commands.md: %w", err)
	}
	return nil
}

// regenerateGuideQuotes splices each "register your first X" guide's
// one real source file (whole, verbatim) into its own marked region --
// same shape as regenerateNounFieldTable/regenerateCommandTable above,
// applied twice for the two guides goal 0231 adds.
func regenerateGuideQuotes(docsRoot string) error {
	quotes := []struct {
		pagePath, sourcePath, lang, beginMarker, endMarker string
	}{
		{
			pagePath:    filepath.Join(docsRoot, "reference", "register-a-canvas-tool.md"),
			sourcePath:  filepath.Join("..", "..", "frontend", "src", "atlas", "tools", "cardTool.ts"),
			lang:        "ts",
			beginMarker: docsgen.RegisterCanvasToolQuoteBeginMarker,
			endMarker:   docsgen.RegisterCanvasToolQuoteEndMarker,
		},
		{
			pagePath:    filepath.Join(docsRoot, "reference", "register-a-command.md"),
			sourcePath:  filepath.Join("..", "..", "frontend", "src", "shared", "secretsCommands.ts"),
			lang:        "ts",
			beginMarker: docsgen.RegisterCommandQuoteBeginMarker,
			endMarker:   docsgen.RegisterCommandQuoteEndMarker,
		},
	}
	for _, q := range quotes {
		existing, err := os.ReadFile(q.pagePath) // #nosec G304 -- fixed path under this repo's own userdocs tree
		if err != nil {
			return fmt.Errorf("read %s: %w", q.pagePath, err)
		}
		quote, err := docsgen.GenerateSourceFileQuote(q.sourcePath, q.lang)
		if err != nil {
			return err
		}
		updated, err := docsgen.ReplaceMarkedRegion(string(existing), q.beginMarker, q.endMarker, quote)
		if err != nil {
			return fmt.Errorf("splice source quote into %s: %w", filepath.Base(q.pagePath), err)
		}
		if err := os.WriteFile(q.pagePath, []byte(updated), 0o600); err != nil { // #nosec G703 -- same fixed path as the read above
			return fmt.Errorf("write %s: %w", q.pagePath, err)
		}
	}
	return nil
}

// regenerateMaturityLedger writes the plugin API maturity ledger
// wholesale (goal 0348) -- both the reference page and its JSON twin,
// computed from repoRoot's own tree (not docsRoot, which only names
// userdocs/ -- the ledger reads pluginsvc/examples/e2e/git history
// across the whole repo).
func regenerateMaturityLedger(docsRoot string) error {
	repoRoot := filepath.Join(docsRoot, "..")
	md := docsgen.GenerateMaturityMarkdown(repoRoot)
	if err := os.WriteFile(filepath.Join(docsRoot, "reference", "plugin-api-maturity.md"), []byte(md), 0o600); err != nil {
		return fmt.Errorf("write plugin-api-maturity.md: %w", err)
	}
	out, err := docsgen.GenerateMaturityJSON(repoRoot)
	if err != nil {
		return fmt.Errorf("generate plugin-api-maturity.json: %w", err)
	}
	if err := os.WriteFile(filepath.Join(docsRoot, "reference", "plugin-api-maturity.json"), []byte(out), 0o600); err != nil {
		return fmt.Errorf("write plugin-api-maturity.json: %w", err)
	}
	return nil
}

// regenerateMenuTable splices the freshly generated menu-bar tables into
// menu-bar.md's one marked region, leaving the rest of the hand-authored
// page untouched -- same shape as regenerateCommandTable above.
func regenerateMenuTable(docsRoot string) error {
	pagePath := filepath.Join(docsRoot, "reference", "menu-bar.md")
	existing, err := os.ReadFile(pagePath) // #nosec G304 -- fixed path under this repo's own userdocs tree
	if err != nil {
		return fmt.Errorf("read menu-bar.md: %w", err)
	}
	frontendSharedDir := filepath.Join("..", "..", "frontend", "src", "shared")
	table, err := docsgen.GenerateMenuTable(frontendSharedDir)
	if err != nil {
		return fmt.Errorf("generate menu table: %w", err)
	}
	updated, err := docsgen.ReplaceMarkedRegion(string(existing), docsgen.MenuTableBeginMarker, docsgen.MenuTableEndMarker, table)
	if err != nil {
		return fmt.Errorf("splice menu table into menu-bar.md: %w", err)
	}
	if err := os.WriteFile(pagePath, []byte(updated), 0o600); err != nil { // #nosec G703 -- same fixed path as the read above
		return fmt.Errorf("write menu-bar.md: %w", err)
	}
	return nil
}

// regenerateReadmeInventory splices the registry-derived inventory into
// README.md's one marked region -- same shape as regenerateCommandTable
// above, one directory up.
func regenerateReadmeInventory(docsRoot string) error {
	readmePath := filepath.Join(docsRoot, "..", "README.md")
	existing, err := os.ReadFile(readmePath) // #nosec G304 -- fixed path at this repo's own root
	if err != nil {
		return fmt.Errorf("read README.md: %w", err)
	}
	inventory, err := docsgen.GenerateReadmeInventory(docsRoot, servicetest.NewFakeStore())
	if err != nil {
		return fmt.Errorf("generate README inventory: %w", err)
	}
	updated, err := docsgen.ReplaceMarkedRegion(string(existing), docsgen.ReadmeInventoryBeginMarker, docsgen.ReadmeInventoryEndMarker, inventory)
	if err != nil {
		return fmt.Errorf("splice inventory into README.md: %w", err)
	}
	if err := os.WriteFile(readmePath, []byte(updated), 0o600); err != nil { // #nosec G703 -- same fixed path as the read above
		return fmt.Errorf("write README.md: %w", err)
	}
	return nil
}
