package composition

// injectSeparator joins injected text and the existing payload with a
// blank line when both are non-empty, so the two don't run together --
// no templating/variable-substitution engine in v1 (SPEC.md §3.3):
// "text" is always literal, static configuration. Conditional injection
// (only inject when some condition holds) is handled by composing this
// node behind an upstream Decision node instead of adding branching
// logic here -- the same "keep the node primitive, let composition do
// the routing" discipline every other Process/Apply node already
// follows.
const injectSeparator = "\n\n"

func init() {
	RegisterNodeType(NodeType{
		ID: "process-inject-text", Kind: KindProcess,
		Label:       "Add text",
		Complexity:  ComplexityBasic,
		Consumes:    []PayloadKind{PayloadText, PayloadNone},
		Produces:    PayloadProduce{Kind: PayloadText},
		Output:      "payload with text injected",
		Description: "Prepends or appends configured static text to the payload, e.g. a fixed hint or instruction pasted alongside a workflow's real output.",
		ConfigFields: []ConfigField{
			{
				Key: "text", Label: "Text to inject",
				Multiline:   true,
				Description: "The literal text this step adds to the payload. Left empty, this step is a no-op.",
				Default:     "",
				Type:        FieldText,
			},
			{
				Key: "placement", Label: "Placement",
				Description: "Where the text goes relative to the existing payload.",
				Default:     "append",
				Type:        FieldOptions,
				Options:     []string{"prepend", "append"},
			},
		},
	}, func(node Node, ctx ExecContext) (ExecContext, error) {
		text := node.Config["text"]
		if text == "" {
			return ctx, nil
		}

		separator := ""
		if ctx.Payload != "" {
			separator = injectSeparator
		}

		if node.Config["placement"] == "prepend" {
			ctx.Payload = text + separator + ctx.Payload
		} else {
			ctx.Payload = ctx.Payload + separator + text
		}
		return ctx, nil
	})
}
