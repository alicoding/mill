package markdown

import (
	"strings"

	"github.com/JohannesKaufmann/dom"
	"github.com/JohannesKaufmann/html-to-markdown/v2/converter"
	"golang.org/x/net/html"
)

// renderConfluenceTaskListItem converts an ak-task-list item
// (li[data-task-state]) into a GFM task-list checkbox. Any state other than
// "DONE" renders unchecked, matching Confluence's own TODO/DONE binary.
func renderConfluenceTaskListItem(ctx converter.Context, w converter.Writer, n *html.Node) converter.RenderStatus {
	if dom.NodeName(n) != "li" {
		return converter.RenderTryNext
	}
	state, ok := dom.GetAttribute(n, "data-task-state")
	if !ok {
		return converter.RenderTryNext
	}

	if strings.EqualFold(state, "DONE") {
		_, _ = w.WriteString("[x] ")
	} else {
		_, _ = w.WriteString("[ ] ")
	}
	ctx.RenderChildNodes(ctx, w, n)

	return converter.RenderSuccess
}
