package markdown

import (
	"regexp"
	"strings"

	"github.com/JohannesKaufmann/dom"
	"github.com/JohannesKaufmann/html-to-markdown/v2/converter"
	"golang.org/x/net/html"
)

// The Office/Word rule set (goal 0305 slice 6): HTML copied out of
// Word, Outlook, OneNote, or Loop carries its check boxes as symbol-
// font glyphs -- a span in the Wingdings face whose TEXT is the
// letter that font draws as a box -- or as literal box characters or
// an <input type=checkbox>. The stock converter keeps the letter ("q",
// "þ") and drops the box (goal 0305's checkmark case). The rule
// set maps the glyphs to their Unicode boxes (the mapping is the
// Wingdings-to-Unicode table, see the goal file) and then turns a box
// that leads a line or a list item into a GFM task mark, the same
// output the Confluence task-list rule produces.

// wingdingsBoxes: Wingdings code points that draw an empty box (o, p,
// q, r, ¨), a checked box (þ), a crossed box (ý), a check mark (ü).
var wingdingsBoxes = map[rune]string{
	'o': "☐", 'p': "☐", 'q': "☐", 'r': "☐", '¨': "☐",
	'þ': "☑", 'ý': "☒", 'ü': "✔",
}

func isSymbolFont(style string) bool {
	lower := strings.ToLower(style)
	return strings.Contains(lower, "wingdings") || strings.Contains(lower, "webdings")
}

// renderOfficeSymbolSpan writes the Unicode box for a Wingdings span
// whose text is one of the box glyphs; anything else falls through.
func renderOfficeSymbolSpan(_ converter.Context, w converter.Writer, n *html.Node) converter.RenderStatus {
	if dom.NodeName(n) != "span" {
		return converter.RenderTryNext
	}
	style, _ := dom.GetAttribute(n, "style")
	face, _ := dom.GetAttribute(n, "face")
	if !isSymbolFont(style) && !isSymbolFont(face) {
		return converter.RenderTryNext
	}
	text := strings.TrimSpace(dom.CollectText(n))
	runes := []rune(text)
	if len(runes) != 1 {
		return converter.RenderTryNext
	}
	box, ok := wingdingsBoxes[runes[0]]
	if !ok {
		return converter.RenderTryNext
	}
	_, _ = w.WriteString(box)
	return converter.RenderSuccess
}

// replaceOfficeCheckboxInputs swaps every checkbox input (a Loop/
// OneNote task, or a Word content control exported as a form field)
// for its box glyph BEFORE rendering: the stock pipeline drops form
// controls outright, so a renderer would never see them.
func replaceOfficeCheckboxInputs(_ converter.Context, doc *html.Node) {
	nodes := dom.FindAllNodes(doc, func(n *html.Node) bool {
		if dom.NodeName(n) != "input" {
			return false
		}
		kind, _ := dom.GetAttribute(n, "type")
		return strings.EqualFold(kind, "checkbox")
	})
	for _, n := range nodes {
		glyph := "☐"
		if _, checked := dom.GetAttribute(n, "checked"); checked {
			glyph = "☑"
		}
		text := &html.Node{Type: html.TextNode, Data: glyph}
		if n.Parent != nil {
			n.Parent.InsertBefore(text, n)
			n.Parent.RemoveChild(n)
		}
	}
}

func registerOfficeRules(conv *converter.Converter) {
	conv.Register.PreRenderer(replaceOfficeCheckboxInputs, converter.PriorityEarly-50) // ahead of the stock pass that drops form controls
	conv.Register.Renderer(renderOfficeSymbolSpan, converter.PriorityEarly)
}

// officeLeadingBox matches a box glyph at the start of a line's text
// (after any list marker and indentation): group 1 the prefix, group 2
// the glyph.
var officeLeadingBox = regexp.MustCompile(`(?m)^(\s*(?:[-*+]|\d+[.)])?\s*)([☐☑☒✔])\s*`)

// officeTaskMarks turns a leading box into a GFM task mark: a bare
// paragraph line becomes a list item ("- [ ] …"), an existing list
// item keeps its marker ("- [x] …").
func officeTaskMarks(md string) string {
	return officeLeadingBox.ReplaceAllStringFunc(md, func(m string) string {
		parts := officeLeadingBox.FindStringSubmatch(m)
		prefix, glyph := parts[1], parts[2]
		mark := "[ ] "
		if glyph == "☑" || glyph == "✔" || glyph == "☒" {
			mark = "[x] "
		}
		if strings.TrimSpace(prefix) == "" {
			return prefix + "- " + mark
		}
		return prefix + mark
	})
}
