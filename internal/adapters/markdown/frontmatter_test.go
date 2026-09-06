package markdown

import (
	"strings"
	"testing"
)

func TestSplitFrontMatter_SeparatesFieldsFromBody(t *testing.T) {
	fm, err := SplitFrontMatter("---\nkind: how-to\nname: x\n---\n\n# Title\n\nBody.\n")
	if err != nil {
		t.Fatalf("SplitFrontMatter: %v", err)
	}
	if fm.Fields["kind"] != "how-to" || fm.Fields["name"] != "x" {
		t.Errorf("fields = %v", fm.Fields)
	}
	if fm.Body != "\n# Title\n\nBody.\n" {
		t.Errorf("body = %q", fm.Body)
	}
}

func TestSplitFrontMatter_NoBlockIsTheWholeSource(t *testing.T) {
	fm, err := SplitFrontMatter("# Title\n\n---\n\nnot front matter\n")
	if err != nil {
		t.Fatalf("SplitFrontMatter: %v", err)
	}
	if len(fm.Fields) != 0 || !strings.HasPrefix(fm.Body, "# Title") {
		t.Errorf("fields=%v body=%q", fm.Fields, fm.Body)
	}
}

func TestSplitFrontMatter_UnclosedBlockIsAnError(t *testing.T) {
	if _, err := SplitFrontMatter("---\nkind: reference\n\n# Title\n"); err == nil {
		t.Error("an unclosed front matter block was accepted")
	}
}

// Regression: an unstripped block renders `---` + a key line + `---`
// as a setext heading, so the Docs surface must never see it.
func TestRenderDocsHTML_DropsFrontMatter(t *testing.T) {
	html, err := RenderDocsHTML("---\nkind: explanation\n---\n\n# Title\n")
	if err != nil {
		t.Fatalf("RenderDocsHTML: %v", err)
	}
	if strings.Contains(html, "kind") || !strings.Contains(html, "<h1") {
		t.Errorf("html = %q", html)
	}
}
