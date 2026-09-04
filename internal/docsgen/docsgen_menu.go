package docsgen

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// menuRow mirrors one entry of frontend/src/shared/menuDeclaration.json
// -- the native menu bar as the frontend projects it, one row per
// rendered item, in bar order. Same generation shape as
// docsgen_commands.go's commandDeclaration: this package has no
// TypeScript parser, so the page reads a committed JSON whose freshness
// menuDeclaration.test.ts pins against the live projection.
type menuRow struct {
	Menu     string `json:"menu"`
	Item     string `json:"item"`
	Shortcut string `json:"shortcut"`
	Command  string `json:"command"`
}

// Markers bounding the one generated region inside the otherwise
// hand-authored userdocs/reference/menu-bar.md.
const (
	MenuTableBeginMarker = "<!-- BEGIN GENERATED: menu bar (source: frontend/src/shared/menuDeclaration.json) -->"
	MenuTableEndMarker   = "<!-- END GENERATED -->"
)

// GenerateMenuTable renders the menu bar as one markdown section per
// menu, rows in the order the menu itself shows them (never re-sorted:
// the order IS the content).
func GenerateMenuTable(frontendSharedDir string) (string, error) {
	raw, err := os.ReadFile(filepath.Join(frontendSharedDir, "menuDeclaration.json")) // #nosec G304 -- caller-controlled fixed path, never external input
	if err != nil {
		return "", fmt.Errorf("read menuDeclaration.json: %w", err)
	}
	var rows []menuRow
	if err := json.Unmarshal(raw, &rows); err != nil {
		return "", fmt.Errorf("parse menuDeclaration.json: %w", err)
	}
	var b strings.Builder
	current := ""
	for _, row := range rows {
		if row.Menu != current {
			if current != "" {
				b.WriteString("\n")
			}
			current = row.Menu
			fmt.Fprintf(&b, "### %s\n\n| Item | Shortcut | Command |\n|---|---|---|\n", row.Menu)
		}
		fmt.Fprintf(&b, "| %s | %s | %s |\n", row.Item, describeShortcut(row.Shortcut), describeMenuCommand(row.Command))
	}
	return b.String(), nil
}

func describeShortcut(shortcut string) string {
	if shortcut == "" {
		return "—"
	}
	return shortcut
}

func describeMenuCommand(id string) string {
	if id == "" {
		return "Provided by macOS"
	}
	return fmt.Sprintf("`%s`", id)
}
