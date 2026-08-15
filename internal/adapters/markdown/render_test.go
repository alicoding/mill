package markdown

import (
	"strings"
	"testing"
)

func TestRenderHTML_ConvertsHeadingsAndEmphasis(t *testing.T) {
	got, err := RenderHTML("# Title\n\nSome **bold** text.")
	if err != nil {
		t.Fatalf("RenderHTML() error: %v", err)
	}
	if !strings.Contains(got, "<h1>Title</h1>") {
		t.Errorf("RenderHTML() = %q, want an <h1>Title</h1>", got)
	}
	if !strings.Contains(got, "<strong>bold</strong>") {
		t.Errorf("RenderHTML() = %q, want <strong>bold</strong>", got)
	}
}

func TestRenderHTML_GFMTable(t *testing.T) {
	got, err := RenderHTML("| A | B |\n| - | - |\n| 1 | 2 |\n")
	if err != nil {
		t.Fatalf("RenderHTML() error: %v", err)
	}
	if !strings.Contains(got, "<table>") {
		t.Errorf("RenderHTML() = %q, want a <table> (GFM extension)", got)
	}
}

// Regression: the safe (non-unsafe) renderer must never pass a
// mirrored file's embedded raw HTML through unescaped -- injecting a
// <script> tag as-is would make the overlay's dangerouslySetInnerHTML
// call an XSS vector against local file content.
func TestRenderHTML_RawHTMLIsNotPassedThroughUnsafely(t *testing.T) {
	got, err := RenderHTML("<script>alert(1)</script>\n\ntext")
	if err != nil {
		t.Fatalf("RenderHTML() error: %v", err)
	}
	if strings.Contains(got, "<script>alert(1)</script>") {
		t.Errorf("RenderHTML() = %q, want the raw <script> tag NOT passed through unescaped", got)
	}
}
