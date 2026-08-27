package docssvc

import (
	"os"
	"strings"
	"testing"
)

// The service runs against the real userdocs tree (the repo root is
// two levels up from this package), exactly what main.go embeds.
func newRealDocsService(t *testing.T) *DocsService {
	t.Helper()
	return New(os.DirFS("../../.."))
}

func TestDocsIndex_MatchesTheCanonicalOrderAndEveryPageRenders(t *testing.T) {
	d := newRealDocsService(t)
	index := d.DocsIndex()
	if len(index) == 0 {
		t.Fatal("empty docs index")
	}
	if index[0].Title != "What is Mill" {
		t.Errorf("first page = %q, want the what-is page first", index[0].Title)
	}
	for _, e := range index {
		html, err := d.DocPageHTML(e.Rel)
		if err != nil {
			t.Errorf("%s: %v", e.Rel, err)
			continue
		}
		if !strings.Contains(html, "<h1") {
			t.Errorf("%s rendered without a heading", e.Rel)
		}
	}
}

func TestDocPageHTML_RefusesUnindexedPaths(t *testing.T) {
	d := newRealDocsService(t)
	for _, rel := range []string{"../go.mod", "start-here/../../../main.go", "nope.md"} {
		if _, err := d.DocPageHTML(rel); err == nil {
			t.Errorf("unindexed path %q was served", rel)
		}
	}
}

// Regression: the TOC rail and heading-anchor links resolve against a
// heading's id attribute -- goldmark does not emit one without
// parser.WithAutoHeadingID(), which DocPageHTML must render through.
func TestDocPageHTML_HeadingsCarryIDs(t *testing.T) {
	d := newRealDocsService(t)
	html, err := d.DocPageHTML("reference/steps.md")
	if err != nil {
		t.Fatalf("DocPageHTML() error: %v", err)
	}
	if !strings.Contains(html, `<h2 id="`) {
		t.Errorf("DocPageHTML() has no id-bearing <h2>, want one for the TOC rail; got %q", html)
	}
}

func TestDocsSearchIndex_CoversEveryPageAndFindsBodyText(t *testing.T) {
	d := newRealDocsService(t)
	entries, err := d.DocsSearchIndex()
	if err != nil {
		t.Fatalf("DocsSearchIndex() error: %v", err)
	}
	want := d.DocsIndex()
	if len(entries) != len(want) {
		t.Fatalf("DocsSearchIndex() returned %d entries, want %d (one per DocsIndex page)", len(entries), len(want))
	}
	var stepsText string
	for _, e := range entries {
		// A real page's prose legitimately contains "<"/">" (steps.md's
		// own "attr:<name>" placeholder syntax) -- markdown.PlainText's
		// own tag-stripping behavior is pinned directly by
		// plaintext_test.go instead of re-asserted here.
		if strings.Contains(e.Text, "<h2") || strings.Contains(e.Text, "</p>") {
			t.Errorf("%s: text %q still contains an HTML tag, want plain text", e.Rel, e.Text)
		}
		if e.Rel == "reference/steps.md" {
			stepsText = e.Text
		}
	}
	if !strings.Contains(stepsText, "Convert HTML to Markdown") {
		t.Errorf("reference/steps.md search text = %q, want it to contain a body phrase from that page", stepsText)
	}
}
