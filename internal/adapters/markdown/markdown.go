// Package markdown wraps html-to-markdown behind Mill's own name, so
// swapping the library later (per CLAUDE.md's ports/adapters rule) never
// touches call sites.
package markdown

import (
	"github.com/JohannesKaufmann/html-to-markdown/v2/converter"
	"github.com/JohannesKaufmann/html-to-markdown/v2/plugin/base"
	"github.com/JohannesKaufmann/html-to-markdown/v2/plugin/commonmark"
	"github.com/JohannesKaufmann/html-to-markdown/v2/plugin/strikethrough"
	"github.com/JohannesKaufmann/html-to-markdown/v2/plugin/table"
)

// ToMarkdown converts HTML to Markdown, preserving structure (headings,
// bold, lists, tables, strikethrough) instead of flattening it to plain
// text. Built via converter.NewConverter with an explicit plugin list
// rather than the library's package-level ConvertString, which wires only
// base+commonmark and silently collapses every table to a single run-on
// line (no plugin/table). registerConfluenceRules adds Mill-owned renderers
// (goal 0042) for Confluence markup the stock plugins degrade or drop.
func ToMarkdown(html string) (string, error) {
	conv := converter.NewConverter(
		converter.WithPlugins(
			base.NewBasePlugin(),
			commonmark.NewCommonmarkPlugin(),
			table.NewTablePlugin(),
			strikethrough.NewStrikethroughPlugin(),
		),
	)
	registerConfluenceRules(conv)
	return conv.ConvertString(html)
}
