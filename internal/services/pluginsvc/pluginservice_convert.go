package pluginsvc

import "github.com/alicoding/mill/internal/adapters/markdown"

// ConvertHTMLToMarkdown is the plugin SDK's convert door (goal 0282):
// the same HTML-to-Markdown conversion every workflow convert step and
// paste already uses, offered to a plugin as a pure transform. No
// capability gates it -- it reaches nothing outside its own input --
// and no plugin id is taken for the same reason.
func (p *PluginService) ConvertHTMLToMarkdown(html string) (string, error) {
	return markdown.ToMarkdown(html)
}
