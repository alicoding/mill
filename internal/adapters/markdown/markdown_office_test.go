package markdown

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// The Office/Word rule set's golden (goal 0305 slice 6): the Word
// paste that broke -- Wingdings check-box glyphs, a literal box, and a
// checkbox input -- becomes GFM task marks with every rule set on, and
// stays raw letters with the rule set off (the profile page's
// side-by-side demonstration).
func TestToMarkdown_OfficeCheckboxes(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("testdata", "office", "word-checkboxes.html"))
	if err != nil {
		t.Fatal(err)
	}
	want, err := os.ReadFile(filepath.Join("testdata", "office", "word-checkboxes.golden.md"))
	if err != nil {
		t.Fatal(err)
	}
	got, err := ToMarkdown(string(raw))
	if err != nil {
		t.Fatalf("ToMarkdown: %v", err)
	}
	if strings.TrimSpace(got) != strings.TrimSpace(string(want)) {
		t.Fatalf("golden mismatch\n--- got ---\n%s\n--- want ---\n%s", got, want)
	}
	off, err := ToMarkdownWith(string(raw), Options{RuleSets: []string{RuleSetConfluence}})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(off, "þ") || strings.Contains(off, "[x]") {
		t.Fatalf("with the office rule set off the glyph letter must survive raw:\n%s", off)
	}
}

func TestOfficeTaskMarks(t *testing.T) {
	in := "☐ first\n- ☑ second\n  * ☒ third\n1. ☐ fourth\nno box ☐ here"
	want := "- [ ] first\n- [x] second\n  * [x] third\n1. [ ] fourth\nno box ☐ here"
	if got := officeTaskMarks(in); got != want {
		t.Fatalf("got\n%s\nwant\n%s", got, want)
	}
}
