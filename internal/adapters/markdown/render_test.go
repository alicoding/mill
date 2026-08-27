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

// Pins the scoping decision (goal 0235 S2): the shared RenderHTML path
// (the mirror preview, a card's note, the update-notice changelog)
// must stay byte-identical -- no id attribute -- while only the
// docs-only RenderDocsHTML entry point gains one.
func TestRenderHTML_NeverGainsHeadingIDs(t *testing.T) {
	got, err := RenderHTML("# Title\n\n## Section One")
	if err != nil {
		t.Fatalf("RenderHTML() error: %v", err)
	}
	if !strings.Contains(got, "<h1>Title</h1>") || !strings.Contains(got, "<h2>Section One</h2>") {
		t.Errorf("RenderHTML() = %q, want attribute-free headings", got)
	}
}

func TestRenderDocsHTML_HeadingsCarryStableSlugIDs(t *testing.T) {
	got, err := RenderDocsHTML("# Title\n\n## Section One\n\n## Section One")
	if err != nil {
		t.Fatalf("RenderDocsHTML() error: %v", err)
	}
	if !strings.Contains(got, `<h1 id="title">Title</h1>`) {
		t.Errorf("RenderDocsHTML() = %q, want a slugified h1 id", got)
	}
	if !strings.Contains(got, `id="section-one"`) || !strings.Contains(got, `id="section-one-1"`) {
		t.Errorf("RenderDocsHTML() = %q, want a duplicate heading's id de-duplicated with a numeric suffix", got)
	}
}
