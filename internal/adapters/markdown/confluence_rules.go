package markdown

import "github.com/JohannesKaufmann/html-to-markdown/v2/converter"

// registerConfluenceRules wires the Confluence-specific renderers/pre-renderers
// documented in goal 0042 onto conv. Every rule returns converter.RenderTryNext
// (or, for the pre-renderer, simply matches nothing) for any node it doesn't
// recognize, so it never overrides the library's own commonmark handling for
// plain HTML.
func registerConfluenceRules(conv *converter.Converter) {
	conv.Register.PreRenderer(addSyntaxHighlighterLanguageClass, converter.PriorityEarly)

	// Must run before the commonmark plugin's own image renderer
	// (registered at PriorityStandard) so it can intercept emoticons first.
	conv.Register.Renderer(renderConfluenceEmoji, converter.PriorityEarly)

	conv.Register.Renderer(renderConfluenceTaskListItem, converter.PriorityStandard)
	conv.Register.Renderer(renderConfluencePanel, converter.PriorityStandard)
	conv.Register.Renderer(renderConfluenceExpand, converter.PriorityStandard)
}
