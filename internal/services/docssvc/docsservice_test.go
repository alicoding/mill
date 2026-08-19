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
