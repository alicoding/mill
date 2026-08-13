package markdown

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// TestToMarkdown_ConfluenceFixtures pins ToMarkdown's behavior against a
// realistic Confluence Cloud markup corpus (goal 0021 Phase 4). Each case
// name states the property the golden pins — for a degrading case, that
// property is the CURRENT loss, deliberately preserved so a future fix is
// a visible test change, not a silent regression.
func TestToMarkdown_ConfluenceFixtures(t *testing.T) {
	tests := []struct {
		name     string
		fixture  string
		property string
	}{
		{
			name:     "table with colspan and rowspan",
			fixture:  "table-colspan-rowspan",
			property: "table structure survives as a real pipe table; spanned cells land top-left with blanks elsewhere",
		},
		{
			name:     "code block macro",
			fixture:  "code-block-macro",
			property: "code content survives in a fenced block; the syntaxhighlighter language hint is currently dropped (no info-string)",
		},
		{
			name:     "info and warning panels",
			fixture:  "info-warning-panels",
			property: "panel body text survives; the info-vs-warning panel type is currently lost (both become plain paragraphs)",
		},
		{
			name:     "three-level nested lists",
			fixture:  "nested-lists-3-level",
			property: "nesting depth and item text survive as indented list items",
		},
		{
			name:     "ak-task-list task list",
			fixture:  "ak-task-list",
			property: "task item text survives as a plain bullet list; DONE/TODO checkbox state is currently dropped (no GFM checkbox syntax)",
		},
		{
			name:     "expand-container macro",
			fixture:  "expand-container",
			property: "control and content text both survive; the expand/collapse semantics are currently lost (flattened to sequential paragraphs)",
		},
		{
			name:     "status lozenge",
			fixture:  "status-lozenge",
			property: "lozenge label text survives; the semantic color/status type is currently lost (plain text, no styling marker)",
		},
		{
			name:     "columnLayout two-equal",
			fixture:  "column-layout-two-equal",
			property: "both column bodies survive as sequential paragraphs (acceptable linearization of a side-by-side layout)",
		},
		{
			name:     "confluence page link",
			fixture:  "page-link",
			property: "the link survives as a real markdown link with its href and text preserved",
		},
		{
			name:     "emoticon with data-emoji-fallback",
			fixture:  "emoticon-emoji-fallback",
			property: "the emoticon currently becomes a dead markdown image link (the data-emoji-fallback character is not used, and the relative image src does not resolve)",
		},
		{
			name:     "panel inside a table cell",
			fixture:  "panel-inside-table-cell",
			property: "the enclosing table structure survives as a one-cell pipe table; the panel type inside the cell is currently lost, same as a standalone panel",
		},
		{
			name:     "bare pre negative control",
			fixture:  "bare-pre-negative-control",
			property: "plain preformatted text with no macro wrapper survives unchanged in a fenced block",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			htmlBytes, err := os.ReadFile(filepath.Join("testdata", "confluence", tt.fixture+".html"))
			if err != nil {
				t.Fatalf("reading fixture: %v", err)
			}
			goldenBytes, err := os.ReadFile(filepath.Join("testdata", "confluence", tt.fixture+".golden.md"))
			if err != nil {
				t.Fatalf("reading golden: %v", err)
			}
			want := strings.TrimSuffix(string(goldenBytes), "\n")

			got, err := ToMarkdown(string(htmlBytes))
			if err != nil {
				t.Fatalf("ToMarkdown returned error: %v", err)
			}
			if got != want {
				t.Errorf("ToMarkdown(%s) pinning %q\ngot:\n%s\nwant:\n%s", tt.fixture, tt.property, got, want)
			}
		})
	}
}
