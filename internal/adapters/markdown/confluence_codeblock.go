package markdown

import (
	"strings"

	"github.com/JohannesKaufmann/dom"
	"github.com/JohannesKaufmann/html-to-markdown/v2/converter"
	"golang.org/x/net/html"
)

// addSyntaxHighlighterLanguageClass feeds Confluence's syntax-highlighter
// language hint into the language-* class convention the commonmark plugin
// already reads: its getCodeLanguage helper only looks at language-*/lang-*
// classes on the pre/code node, never data-syntaxhighlighter-params.
func addSyntaxHighlighterLanguageClass(_ converter.Context, doc *html.Node) {
	nodes := dom.FindAllNodes(doc, func(n *html.Node) bool {
		if dom.NodeName(n) != "pre" {
			return false
		}
		_, ok := dom.GetAttribute(n, "data-syntaxhighlighter-params")
		return ok
	})

	for _, n := range nodes {
		params := dom.GetAttributeOr(n, "data-syntaxhighlighter-params", "")
		lang, ok := syntaxHighlighterBrushLanguage(params)
		if !ok {
			continue
		}
		appendClass(n, "language-"+lang)
	}
}

// syntaxHighlighterBrushLanguage parses Confluence's
// `data-syntaxhighlighter-params="brush: java; gutter: false; ..."` format —
// a semicolon-separated list of `key: value` pairs — and returns the brush's
// language.
func syntaxHighlighterBrushLanguage(params string) (string, bool) {
	for _, part := range strings.Split(params, ";") {
		kv := strings.SplitN(part, ":", 2)
		if len(kv) != 2 {
			continue
		}
		if !strings.EqualFold(strings.TrimSpace(kv[0]), "brush") {
			continue
		}
		lang := strings.TrimSpace(kv[1])
		if lang == "" {
			return "", false
		}
		return lang, true
	}
	return "", false
}

// appendClass adds className to node's class attribute, creating the
// attribute if it isn't already present.
func appendClass(n *html.Node, className string) {
	for i, attr := range n.Attr {
		if attr.Key == "class" {
			n.Attr[i].Val = attr.Val + " " + className
			return
		}
	}
	n.Attr = append(n.Attr, html.Attribute{Key: "class", Val: className})
}
