package composition

import (
	"fmt"

	"github.com/alicoding/mill/internal/domain/guardrail"
)

// atlasCardLinkFn creates a typed relation between two Atlas cards --
// injected so this domain package never depends on atlassvc's storage.
// Links carry no cycle-guard bookkeeping (docs/goals/0066's trigger only
// fires on card create/update, never on a link), so unlike
// atlasCardCreateFn/atlasCardUpdateFn there's no sourceRunID to thread.
// Defaults to erroring so a node run before SetAtlasCardLinker is wired
// fails loudly.
var atlasCardLinkFn = func(fromCardID, toCardID, linkKindID, label string) error {
	return fmt.Errorf("no atlas card linker registered (yet)")
}

// SetAtlasCardLinker wires the function apply-atlas-card-link nodes use
// to create a link. Called once from main.go once AtlasService exists.
func SetAtlasCardLinker(fn func(fromCardID, toCardID, linkKindID, label string) error) {
	atlasCardLinkFn = fn
}

func init() {
	RegisterNodeType(NodeType{
		ID: "apply-atlas-card-link", Kind: KindApply,
		Label:      "Atlas: link cards",
		Effect:     guardrail.ClassLocal,
		Complexity: ComplexityBasic,
		Output:     "payload unchanged",
		Description: "Creates a typed relation between two existing Atlas cards. \"From\"/\"To\" are each a " +
			"literal card id or attr:<name>.",
		ConfigFields: []ConfigField{
			{
				Key: "fromCardId", Label: "From", Type: FieldText,
				Description: "The relation's source card -- a literal card id, or attr:<name>.",
			},
			{
				Key: "toCardId", Label: "To", Type: FieldText,
				Description: "The relation's target card -- a literal card id, or attr:<name>.",
			},
			{
				Key: "linkKindId", Label: "Relation", Type: FieldText, RefKind: "atlas-linkkind",
				Description: "Which kind of relation this is.",
			},
			{
				Key: "label", Label: "Label (optional)", Type: FieldText,
				Description: "An optional note describing this specific relation.",
			},
		},
	}, execAtlasCardLink)
}

func execAtlasCardLink(node Node, ctx ExecContext) (ExecContext, error) {
	fromID := resolveBindingValue(node.Config["fromCardId"], ctx.Attributes)
	toID := resolveBindingValue(node.Config["toCardId"], ctx.Attributes)
	linkKindID := node.Config["linkKindId"]
	if fromID == "" || toID == "" {
		return ctx, fmt.Errorf("apply-atlas-card-link: from/to card ids are required")
	}
	if linkKindID == "" {
		return ctx, fmt.Errorf("apply-atlas-card-link: linkKindId is required")
	}
	if err := atlasCardLinkFn(fromID, toID, linkKindID, node.Config["label"]); err != nil {
		return ctx, fmt.Errorf("apply-atlas-card-link: %w", err)
	}
	return ctx, nil
}
