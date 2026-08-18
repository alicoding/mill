package composition

import (
	"fmt"

	"github.com/alicoding/mill/internal/domain/guardrail"
)

// atlasCardUpdateFn merges fields into an existing Atlas card --
// injected so this domain package never depends on atlassvc's storage.
// sourceRunID mirrors atlasCardCreateFn's own doc comment. Defaults to
// erroring so a node run before SetAtlasCardUpdater is wired fails
// loudly.
var atlasCardUpdateFn = func(cardID string, fields map[string]string, sourceRunID string) (AtlasCard, error) {
	return AtlasCard{}, fmt.Errorf("no atlas card updater registered (yet) for card %q", cardID)
}

// SetAtlasCardUpdater wires the function apply-atlas-card-update nodes
// use to merge field values into a card. Called once from main.go once
// AtlasService exists.
func SetAtlasCardUpdater(fn func(cardID string, fields map[string]string, sourceRunID string) (AtlasCard, error)) {
	atlasCardUpdateFn = fn
}

func init() {
	RegisterNodeType(NodeType{
		ID: "apply-atlas-card-update", Kind: KindApply,
		Label:      "Update Atlas card",
		Effect:     guardrail.ClassLocal,
		Complexity: ComplexityAdvanced,
		Output:     "payload unchanged; the updated card's id -> the output attribute, if named",
		Description: "Writes field values onto an existing Atlas card, resolved by \"Card\" (a literal card " +
			"id or attr:<name> -- e.g. attr:cardId from a trigger-atlas-card event, or an earlier " +
			"Atlas: find cards result). Only the fields named in \"Field values\" change; everything else " +
			"on the card is untouched.",
		ConfigFields: []ConfigField{
			{
				Key: "kindId", Label: "Kind", Type: FieldText, RefKind: "atlas-kind",
				Description: "The card's own Kind -- names which field keys \"Field values\" may bind.",
			},
			{
				Key: "cardId", Label: "Card", Type: FieldText,
				Description: "Which card to update -- a literal card id, or attr:<name>.",
			},
			{
				Key: "fieldBindings", Label: "Field values", Type: FieldText, Multiline: true,
				Description: `JSON object mapping the Kind's field keys to a literal or attr:<name>, ` +
					`e.g. {"status":"Processed"}.`,
			},
			{
				Key: "outputAttribute", Label: "Output attribute (optional)", Type: FieldText,
				Description: "Which Attributes field receives the updated card's id.",
			},
		},
	}, execAtlasCardUpdate)
}

func execAtlasCardUpdate(node Node, ctx ExecContext) (ExecContext, error) {
	cardID := resolveBindingValue(node.Config["cardId"], ctx.Attributes)
	if cardID == "" {
		return ctx, fmt.Errorf("apply-atlas-card-update: cardId is required")
	}
	bindings, err := parseBindings(node.Config["fieldBindings"])
	if err != nil {
		return ctx, fmt.Errorf("apply-atlas-card-update: fieldBindings: %w", err)
	}
	fields := make(map[string]string, len(bindings))
	for k, raw := range bindings {
		fields[k] = resolveBindingValue(raw, ctx.Attributes)
	}

	card, err := atlasCardUpdateFn(cardID, fields, currentRunID(ctx.RunContext))
	if err != nil {
		return ctx, fmt.Errorf("apply-atlas-card-update: %w", err)
	}
	if outAttr := node.Config["outputAttribute"]; outAttr != "" {
		if ctx.Attributes == nil {
			ctx.Attributes = map[string]any{}
		}
		ctx.Attributes[outAttr] = card.ID
	}
	return ctx, nil
}
