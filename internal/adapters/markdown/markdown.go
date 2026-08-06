// Package markdown wraps html-to-markdown behind Mill's own name, so
// swapping the library later (per CLAUDE.md's ports/adapters rule) never
// touches call sites.
package markdown

import htmltomarkdown "github.com/JohannesKaufmann/html-to-markdown/v2"

// ToMarkdown converts HTML to Markdown, preserving structure (headings,
// bold, lists) instead of flattening it to plain text.
func ToMarkdown(html string) (string, error) {
	return htmltomarkdown.ConvertString(html)
}
