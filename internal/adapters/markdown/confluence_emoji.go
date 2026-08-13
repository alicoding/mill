package markdown

import (
	"github.com/JohannesKaufmann/dom"
	"github.com/JohannesKaufmann/html-to-markdown/v2/converter"
	"golang.org/x/net/html"
)

// renderConfluenceEmoji emits an emoticon's data-emoji-fallback text instead
// of the commonmark image renderer's image link, whose relative src never
// resolves outside Confluence — the fallback is the only part of an
// emoticon that survives export.
func renderConfluenceEmoji(_ converter.Context, w converter.Writer, n *html.Node) converter.RenderStatus {
	if dom.NodeName(n) != "img" || !dom.HasClass(n, "emoticon") {
		return converter.RenderTryNext
	}
	fallback, ok := dom.GetAttribute(n, "data-emoji-fallback")
	if !ok || fallback == "" {
		return converter.RenderTryNext
	}

	_, _ = w.WriteString(fallback)
	return converter.RenderSuccess
}
