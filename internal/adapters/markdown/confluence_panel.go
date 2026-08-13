package markdown

import (
	"bytes"
	"strings"

	"github.com/JohannesKaufmann/dom"
	"github.com/JohannesKaufmann/html-to-markdown/v2/converter"
	"golang.org/x/net/html"
)

// confluencePanelLabels maps a Confluence information-macro's type suffix
// (confluence-information-macro-<type>) to the bold label its blockquote
// leads with. Confluence's "Info" panel carries the CSS type "information",
// not "info".
var confluencePanelLabels = map[string]string{
	"information": "Info",
	"note":        "Note",
	"warning":     "Warning",
	"tip":         "Tip",
}

const confluencePanelMacroClassPrefix = "confluence-information-macro-"

// renderConfluencePanel converts an info/note/warning/tip panel macro into a
// blockquote whose first line names the panel type, so the type survives
// instead of collapsing every panel into an identical plain paragraph.
//
// Never fires inside a table cell: a GFM pipe-table cell can't hold a
// block-level blockquote (the table plugin drops the whole table if any
// cell's rendered content contains a newline), so a panel nested in one
// keeps degrading to plain text exactly as it did before this rule existed.
func renderConfluencePanel(ctx converter.Context, w converter.Writer, n *html.Node) converter.RenderStatus {
	if dom.NodeName(n) != "div" {
		return converter.RenderTryNext
	}
	label, ok := confluencePanelLabel(n)
	if !ok || hasAncestorTableCell(n) {
		return converter.RenderTryNext
	}

	var buf bytes.Buffer
	ctx.RenderChildNodes(ctx, &buf, n)
	content := bytes.TrimSpace(buf.Bytes())
	if content == nil {
		return converter.RenderSuccess
	}

	body := append([]byte("**"+label+":** "), content...)

	_, _ = w.WriteString("\n\n")
	_, _ = w.Write(prefixEachLine(body, "> "))
	_, _ = w.WriteString("\n\n")

	return converter.RenderSuccess
}

func confluencePanelLabel(n *html.Node) (string, bool) {
	for _, class := range dom.GetClasses(n) {
		if !strings.HasPrefix(class, confluencePanelMacroClassPrefix) {
			continue
		}
		panelType := strings.TrimPrefix(class, confluencePanelMacroClassPrefix)
		if label, ok := confluencePanelLabels[panelType]; ok {
			return label, true
		}
	}
	return "", false
}

func hasAncestorTableCell(n *html.Node) bool {
	for p := n.Parent; p != nil; p = p.Parent {
		name := dom.NodeName(p)
		if name == "td" || name == "th" {
			return true
		}
	}
	return false
}

// prefixEachLine prepends prefix to every line of content, mirroring the
// commonmark plugin's own blockquote-prefixing convention (including a
// trailing space on otherwise-blank lines).
func prefixEachLine(content []byte, prefix string) []byte {
	lines := bytes.Split(content, []byte("\n"))
	for i, line := range lines {
		lines[i] = append([]byte(prefix), line...)
	}
	return bytes.Join(lines, []byte("\n"))
}
