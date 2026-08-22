package atlas

import (
	"os"
	"testing"

	"github.com/alicoding/mill/internal/domain/typedfield"
)

// testdata holds SELF-CONTAINED fixtures reproducing the goal-archive
// frontmatter shapes this parser must handle -- never point a test in
// this repo at docs/goals/archive directly. docs/ is a separate nested
// repo, gitignored from mill (.gitignore's "/docs/"), so it does not
// exist in a CI checkout: a test that reads it passes locally and
// fails structurally in CI every time.
const testdataDir = "testdata"

func TestParseFrontmatter_NormalFile(t *testing.T) {
	content, err := os.ReadFile(testdataDir + "/normal-goal.md")
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
	if fm["id"] != "0108" {
		t.Errorf("id = %v, want %q", fm["id"], "0108")
	}
	if fm["status"] != "shipped" {
		t.Errorf("status = %v, want %q", fm["status"], "shipped")
	}
	if fm["date"] != "2026-08-18" {
		t.Errorf("date = %v, want %q", fm["date"], "2026-08-18")
	}
}

// TestParseFrontmatter_HorizontalRuleEdgeFiles is the regression pin
// for a real parser hazard docs/goals/archive/0036 and /0037 both
// exercise (reproduced structurally in testdata/horizontal-rule-goal.md,
// since a test in this repo may never read the nested docs repo): a
// standalone "---" markdown horizontal rule sits between the
// frontmatter's closing delimiter and the "# Title" heading. A parser
// that treats every standalone "---" line as a frontmatter boundary
// would misparse the heading's own text as YAML, or open a phantom
// second frontmatter block.
func TestParseFrontmatter_HorizontalRuleEdgeFiles(t *testing.T) {
	cases := []struct {
		file    string
		wantID  string
		wantPRs int
	}{
		{"horizontal-rule-goal.md", "0036", 0},
	}
	for _, tc := range cases {
		content, err := os.ReadFile(testdataDir + "/" + tc.file)
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
		if fm["id"] != tc.wantID {
			t.Errorf("%s: id = %v, want %q", tc.file, fm["id"], tc.wantID)
		}
		prs, _ := fm["prs"].([]any)
		if len(prs) != tc.wantPRs {
			t.Errorf("%s: len(prs) = %d, want %d -- the body's own horizontal rule "+
				"or heading text leaked into the parsed header", tc.file, len(prs), tc.wantPRs)
		}
		if fm["status"] == "" || fm["status"] == nil {
			t.Errorf("%s: status is empty, frontmatter likely mis-bounded", tc.file)
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
	prs, _ := fm["prs"].([]any)
	if len(prs) != 2 || prs[0] != "321" || prs[1] != "322" {
		t.Errorf("prs = %v, want [321 322]", fm["prs"])
	}
	proof, _ := fm["proof"].([]any)
	if len(proof) != 2 {
		t.Errorf("proof = %v, want 2 entries", fm["proof"])
	}
}

// TestParseFrontmatter_ArbitraryKeys proves the parser understands ANY
// YAML header, not just Mill's own goal-file convention (goal 0172):
// a folder using entirely non-Mill keys parses into the same generic
// map shape a "ticket"/"owner"/"released" Kind would consume with no
// code change.
func TestParseFrontmatter_ArbitraryKeys(t *testing.T) {
	content := []byte("---\n" +
		"ticket: \"OPS-42\"\n" +
		"owner: \"jane\"\n" +
		"released: true\n" +
		"---\n\n# An unrelated document\n")
	fm, ok, err := ParseFrontmatter(content)
	if err != nil {
		t.Fatalf("ParseFrontmatter: %v", err)
	}
	if !ok {
		t.Fatal("expected frontmatter to be found")
	}
	if fm["ticket"] != "OPS-42" {
		t.Errorf("ticket = %v, want %q", fm["ticket"], "OPS-42")
	}
	if fm["owner"] != "jane" {
		t.Errorf("owner = %v, want %q", fm["owner"], "jane")
	}
	if fm["released"] != true {
		t.Errorf("released = %v, want true", fm["released"])
	}
}

// TestCoerceFrontmatterFields_KindIsTheContract pins goal 0172's core
// rule: a frontmatter key with a matching Field.Key is written; a key
// with no matching field is silently ignored, with no mapping config
// involved on either side.
func TestCoerceFrontmatterFields_KindIsTheContract(t *testing.T) {
	raw := map[string]any{
		"ticket":   "OPS-42",
		"owner":    "jane",
		"released": true,
		"unmapped": "never written -- no field named this",
	}
	fields := []typedfield.Field{
		{Key: "ticket", Type: typedfield.TypeText},
		{Key: "owner", Type: typedfield.TypeText},
		{Key: "released", Type: typedfield.TypeBoolean},
		// approval has no key in raw at all -- an owner-owned field, by
		// construction absent from the coerced result.
		{Key: "approval", Type: typedfield.TypeOptions, Options: []string{"pending", "approved"}},
	}
	got := CoerceFrontmatterFields(raw, fields)
	want := map[string]string{"ticket": "OPS-42", "owner": "jane", "released": "true"}
	if len(got) != len(want) {
		t.Fatalf("got %v, want exactly %v", got, want)
	}
	for k, v := range want {
		if got[k] != v {
			t.Errorf("got[%q] = %q, want %q", k, got[k], v)
		}
	}
	if _, ok := got["approval"]; ok {
		t.Errorf("approval must be absent -- the file carries no such key, got %q", got["approval"])
	}
	if _, ok := got["unmapped"]; ok {
		t.Errorf("unmapped must be absent -- no Field declares that key, got %q", got["unmapped"])
	}
}

// TestCoerceFrontmatterFields_FrontmatterAliases pins the one narrow
// escape hatch a Field may declare (docs/goals/0172): a raw key that
// doesn't literally match the Field's own Key still resolves via
// FrontmatterAliases, checked only when the literal Key itself has no
// match.
func TestCoerceFrontmatterFields_FrontmatterAliases(t *testing.T) {
	raw := map[string]any{"id": "9001"}
	fields := []typedfield.Field{
		{Key: "goalId", Type: typedfield.TypeText, FrontmatterAliases: []string{"id"}},
	}
	got := CoerceFrontmatterFields(raw, fields)
	if got["goalId"] != "9001" {
		t.Errorf("goalId = %q, want %q", got["goalId"], "9001")
	}
}

// TestCoerceFrontmatterFields_ListAndDateCoercion pins the "sensible
// coercion" contract: a YAML list joins into the same comma-separated
// text Mill's own field values already use, and an unquoted date-
// shaped scalar (YAML's own timestamp resolution) formats as
// YYYY-MM-DD, matching the quoted-string convention the goal archive
// already uses.
func TestCoerceFrontmatterFields_ListAndDateCoercion(t *testing.T) {
	content := []byte("---\n" +
		"prs: [\"100\", \"101\"]\n" +
		"released: 2026-08-01\n" +
		"---\n")
	raw, ok, err := ParseFrontmatter(content)
	if err != nil || !ok {
		t.Fatalf("ParseFrontmatter: ok=%v err=%v", ok, err)
	}
	fields := []typedfield.Field{
		{Key: "prs", Type: typedfield.TypeText, Multiline: true},
		{Key: "released", Type: typedfield.TypeDate},
	}
	got := CoerceFrontmatterFields(raw, fields)
	if got["prs"] != "100, 101" {
		t.Errorf("prs = %q, want %q", got["prs"], "100, 101")
	}
	if got["released"] != "2026-08-01" {
		t.Errorf("released = %q, want %q", got["released"], "2026-08-01")
	}
}
