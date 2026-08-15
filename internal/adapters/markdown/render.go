package markdown

import (
	"bytes"
	"fmt"

	"github.com/yuin/goldmark"
	"github.com/yuin/goldmark/extension"
)

// renderer is built once -- goldmark.New's own doc comment describes
// the returned Markdown value as safe for concurrent Convert calls, so
// there is no reason to reconstruct it per call the way ToMarkdown
// reconstructs its converter (that one carries Mill-owned Confluence
// rule state that must not leak between unrelated conversions; this
// one carries none).
//
// extension.GFM adds tables/strikethrough/autolinks/task lists --
// commonmark alone renders a mirrored file's real-world markdown (a
// README, a set of notes) as a wall of unbroken paragraphs whenever it
// contains any of those. Deliberately NOT goldmark.WithRendererOptions
// (html.WithUnsafe): the default renderer escapes/drops raw HTML
// embedded in the source instead of passing it through, which is what
// makes RenderHTML's output safe to inject into the DOM as-is -- a
// mirrored file is local content the user pointed a card at, but
// still not something to trust as pre-sanitized HTML.
var renderer = goldmark.New(goldmark.WithExtensions(extension.GFM))

// RenderHTML converts source (CommonMark + GFM) to an HTML string --
// the mirror-content overlay's own markdown path (docs/goals/0064).
func RenderHTML(source string) (string, error) {
	var buf bytes.Buffer
	if err := renderer.Convert([]byte(source), &buf); err != nil {
		return "", fmt.Errorf("markdown: render: %w", err)
	}
	return buf.String(), nil
}
