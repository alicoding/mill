package markdown

import (
	"bytes"
	"strings"

	"github.com/JohannesKaufmann/dom"
	"github.com/JohannesKaufmann/html-to-markdown/v2/converter"
	"golang.org/x/net/html"
)

// renderConfluenceExpand converts an expand-container macro into a GFM
// <details>/<summary> block — a raw HTML block whose content, per the GFM
// spec, keeps rendering as markdown as long as it's blank-line-separated
// from the surrounding tags — instead of flattening the control and content
// into sequential, indistinguishable paragraphs.
func renderConfluenceExpand(ctx converter.Context, w converter.Writer, n *html.Node) converter.RenderStatus {
	if dom.NodeName(n) != "div" || !dom.HasClass(n, "expand-container") {
		return converter.RenderTryNext
	}

	control := dom.FindFirstNode(n, func(c *html.Node) bool {
		return dom.NodeName(c) == "div" && dom.HasClass(c, "expand-control")
	})
	content := dom.FindFirstNode(n, func(c *html.Node) bool {
		return dom.NodeName(c) == "div" && dom.HasClass(c, "expand-content")
	})

	title := ""
	if control != nil {
		title = strings.TrimSpace(dom.CollectText(control))
	}

	var body bytes.Buffer
	if content != nil {
		ctx.RenderChildNodes(ctx, &body, content)
	}
	bodyContent := bytes.TrimSpace(body.Bytes())

	_, _ = w.WriteString("\n\n<details>\n<summary>")
	_, _ = w.WriteString(title)
	_, _ = w.WriteString("</summary>\n\n")
	_, _ = w.Write(bodyContent)
	_, _ = w.WriteString("\n\n</details>\n\n")

	return converter.RenderSuccess
}
