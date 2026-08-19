package compositionsvc

import "github.com/alicoding/mill/internal/adapters/markdown"

// PreviewHTMLToMarkdown converts html through the same converter
// process-html-to-markdown's node execution uses (htmlToMarkdown in
// internal/domain/composition/processmarkdown.go), so the inspector's
// "Try it" preview always matches what a real run would produce. Empty
// input returns empty without invoking the converter -- there's nothing
// to preview.
func (c *CompositionService) PreviewHTMLToMarkdown(html string) (string, error) {
	if html == "" {
		return "", nil
	}
	return markdown.ToMarkdown(html)
}
