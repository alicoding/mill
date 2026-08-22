package atlas

import (
	"os"
	"testing"
)

const archiveDir = "../../../docs/goals/archive"

func TestParseFrontmatter_NormalFile(t *testing.T) {
	content, err := os.ReadFile(archiveDir + "/0108-atlas-self-portrait.md")
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	fm, ok, err := ParseFrontmatter(content)
	if err != nil {
		t.Fatalf("ParseFrontmatter: %v", err)
	}
	if !ok {
		t.Fatal("expected frontmatter to be found")
	}
	if fm.ID != "0108" {
		t.Errorf("ID = %q, want %q", fm.ID, "0108")
	}
	if fm.Status != "shipped" {
		t.Errorf("Status = %q, want %q", fm.Status, "shipped")
	}
	if fm.Date != "2026-08-18" {
		t.Errorf("Date = %q, want %q", fm.Date, "2026-08-18")
	}
}

// TestParseFrontmatter_HorizontalRuleEdgeFiles is the regression pin
// for the parser hazard these two files exercise: a standalone "---"
// markdown horizontal rule sits between the frontmatter's closing
// delimiter and the "# Title" heading. A parser that treats every
// standalone "---" line as a frontmatter boundary would misparse the
// heading's own text as YAML, or open a phantom second frontmatter
// block -- both files must still parse to exactly their real header
// fields.
func TestParseFrontmatter_HorizontalRuleEdgeFiles(t *testing.T) {
	cases := []struct {
		file    string
		wantID  string
		wantPRs int
	}{
		{"0036-view-mode-ux-hardening.md", "0036", 0},
		{"0037-seed-lifecycle.md", "0037", 0},
	}
	for _, tc := range cases {
		content, err := os.ReadFile(archiveDir + "/" + tc.file)
		if err != nil {
			t.Fatalf("read fixture %s: %v", tc.file, err)
		}
		fm, ok, err := ParseFrontmatter(content)
		if err != nil {
			t.Fatalf("ParseFrontmatter(%s): %v", tc.file, err)
		}
		if !ok {
			t.Fatalf("%s: expected frontmatter to be found", tc.file)
		}
		if fm.ID != tc.wantID {
			t.Errorf("%s: ID = %q, want %q", tc.file, fm.ID, tc.wantID)
		}
		if len(fm.PRs) != tc.wantPRs {
			t.Errorf("%s: len(PRs) = %d, want %d -- the body's own horizontal rule "+
				"or heading text leaked into the parsed header", tc.file, len(fm.PRs), tc.wantPRs)
		}
		if fm.Status == "" {
			t.Errorf("%s: Status is empty, frontmatter likely mis-bounded", tc.file)
		}
	}
}

func TestParseFrontmatter_NoFrontmatter(t *testing.T) {
	fm, ok, err := ParseFrontmatter([]byte("# Just a heading\n\nSome body text.\n"))
	if err != nil {
		t.Fatalf("ParseFrontmatter: %v", err)
	}
	if ok {
		t.Errorf("expected ok = false, got frontmatter %+v", fm)
	}
}

func TestParseFrontmatter_UnclosedDelimiter(t *testing.T) {
	fm, ok, err := ParseFrontmatter([]byte("---\nid: \"0001\"\n# no closing delimiter\n"))
	if err != nil {
		t.Fatalf("ParseFrontmatter: %v", err)
	}
	if ok {
		t.Errorf("expected ok = false for an unclosed delimiter, got %+v", fm)
	}
}

func TestParseFrontmatter_ArraysAndEmptyFields(t *testing.T) {
	content := []byte("---\n" +
		"id: \"0164\"\n" +
		"status: shipped\n" +
		"date: \"2026-08-21\"\n" +
		"prs: [\"321\", \"322\"]\n" +
		"proof: [\"TestFoo\", \"TestBar\"]\n" +
		"spec_refs: [\"9.5\"]\n" +
		"---\n\n# 0164 -- Title\n")
	fm, ok, err := ParseFrontmatter(content)
	if err != nil {
		t.Fatalf("ParseFrontmatter: %v", err)
	}
	if !ok {
		t.Fatal("expected frontmatter to be found")
	}
	if len(fm.PRs) != 2 || fm.PRs[0] != "321" || fm.PRs[1] != "322" {
		t.Errorf("PRs = %v, want [321 322]", fm.PRs)
	}
	if len(fm.Proof) != 2 {
		t.Errorf("Proof = %v, want 2 entries", fm.Proof)
	}
}
