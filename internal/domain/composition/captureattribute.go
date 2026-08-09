package composition

import "fmt"

// capture-attribute reads one of the workflow's own typed Attributes
// into the payload -- the missing piece that let nothing downstream
// actually *use* a typed input before (inject-text is deliberately
// literal-only): a callable child workflow receives its typed input as
// Attributes (docs/adr/0010), and this node is how a step turns that
// input into working payload. Registered via ADR-0006's
// self-registration pattern -- this whole file is the addition, no
// central list edited.
func init() {
	RegisterNodeType(NodeType{
		ID: "capture-attribute", Kind: KindCapture,
		Label:       "Capture: attribute value",
		Description: "Replaces the payload with the value of one of this workflow's declared Attributes -- e.g. a callable workflow's typed input, or a value a Decision already routed on.",
		ConfigFields: []ConfigField{
			{
				Key: "attribute", Label: "Attribute",
				Description: "The declared Attribute key to read (Configure > Attributes, or the typed input a calling workflow bound).",
				Default:     "", Type: FieldText,
			},
		},
	}, func(node Node, ctx ExecContext) (ExecContext, error) {
		key := node.Config["attribute"]
		if key == "" {
			return ctx, fmt.Errorf("capture-attribute: no attribute key configured")
		}
		v, ok := ctx.Attributes[key]
		if !ok {
			return ctx, fmt.Errorf("capture-attribute: no attribute %q on this run (declared attributes seed at their zero value; a calling workflow's binding or a test run's value overrides them)", key)
		}
		ctx.Payload = fmt.Sprintf("%v", v)
		return ctx, nil
	})
}
