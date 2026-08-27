package markdown

import (
	"strings"

	"golang.org/x/net/html"
)

// PlainText strips an HTML string down to its visible text, collapsing
// runs of whitespace to a single space -- the Docs surface's
// client-side search index matches and snippets against this, not
// against markdown syntax or tag soup. golang.org/x/net/html is
// already a direct module dependency (go.mod), so this walks its own
// tokenizer rather than a hand-rolled regex tag-stripper, which breaks
// on nested/malformed markup a real tokenizer doesn't.
func PlainText(source string) string {
	tokenizer := html.NewTokenizer(strings.NewReader(source))
	var b strings.Builder
	for {
		switch tokenizer.Next() {
		case html.ErrorToken:
			return strings.Join(strings.Fields(b.String()), " ")
		case html.TextToken:
			b.Write(tokenizer.Text())
			b.WriteByte(' ')
		}
	}
}
