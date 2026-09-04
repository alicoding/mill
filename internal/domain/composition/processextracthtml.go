package composition

import "github.com/alicoding/mill/internal/adapters/htmlextract"

// The default selector targets the common main-content containers real
// pages actually use (a WordPress/Confluence/generic-article-shaped
// page tends to land on one of these) -- editable, not a fixed
// assumption: a saved page whose real content lives under a different
// selector just needs the Inspector field changed, no code change.
const defaultExtractSelector = "#main-content, main, article"

func init() {
	RegisterNodeType(NodeType{
		ID: "process-extract-html", Kind: KindProcess,
		Label:       "Extract HTML section",
		Complexity:  ComplexityBasic,
		Consumes:    []PayloadKind{PayloadHTML},
		Produces:    PayloadProduce{Kind: PayloadHTML},
		Output:      "the matched element's outer HTML",
		Description: "Extracts one element (by CSS selector) out of the payload's HTML, dropping everything else, e.g. a saved page's main-content region, stripping nav/header/footer chrome before converting to Markdown. Fails the step if nothing matches (fail-safe: never silently passes the whole, unfiltered document through).",
		ConfigFields: []ConfigField{
			{
				Key: "selector", Label: "CSS selector",
				Description: "A CSS selector, optionally comma-separated (e.g. \"#main-content, main, article\"). The first matching element (in document order) is kept.",
				Default:     defaultExtractSelector, Type: FieldText,
			},
		},
	}, func(node Node, ctx ExecContext) (ExecContext, error) {
		selector := node.Config["selector"]
		if selector == "" {
			selector = defaultExtractSelector
		}
		out, err := htmlextract.Extract(ctx.Payload, selector)
		if err != nil {
			return ctx, err
		}
		ctx.Payload = out
		return ctx, nil
	})
}
