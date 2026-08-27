package markdown

import "testing"

func TestPlainText_StripsTagsAndCollapsesWhitespace(t *testing.T) {
	got := PlainText("<h1 id=\"title\">Title</h1>\n\n<p>Some   <strong>bold</strong>\ntext.</p>")
	want := "Title Some bold text."
	if got != want {
		t.Errorf("PlainText() = %q, want %q", got, want)
	}
}

func TestPlainText_TableCellsReadAsSpaceSeparatedText(t *testing.T) {
	got := PlainText(`<table><tr><td>A</td><td>B</td></tr></table>`)
	want := "A B"
	if got != want {
		t.Errorf("PlainText() = %q, want %q", got, want)
	}
}
