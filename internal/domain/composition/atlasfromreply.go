package composition

import (
	"encoding/json"
	"fmt"

	"github.com/alicoding/mill/internal/domain/guardrail"
)

// atlasReplyMaterializerFn turns a VALIDATED, user-accepted clipboard
// bridge reply's items (goal 0099 -- JSON array of drafts, each either
// a card draft with "title" or a note draft with "text") into real
// Atlas records -- injected so this domain package never depends on
// atlassvc's storage (.claude/rules/backend.md), which owns kind-label
// resolution, field mapping, and the Scratchpad landing for notes.
// parentID names the card new CARD items land inside ("" for the board
// root); a note item always lands in the fixed Scratchpad regardless of
// parentID, unaffected by this parameter. Returns a short JSON summary
// ({"cards":N,"notes":N,"ids":[...]}). Defaults to erroring so a node
// run before SetAtlasReplyMaterializer is wired fails loudly.
var atlasReplyMaterializerFn = func(itemsJSON, parentID, sourceRunID string) (string, error) {
	return "", fmt.Errorf("no atlas reply materializer registered (yet)")
}

// SetAtlasReplyMaterializer wires the function apply-atlas-from-reply
// nodes use. Called once from main.go once AtlasService exists.
func SetAtlasReplyMaterializer(fn func(itemsJSON, parentID, sourceRunID string) (string, error)) {
	atlasReplyMaterializerFn = fn
}

func init() {
	RegisterNodeType(NodeType{
		ID: "apply-atlas-from-reply", Kind: KindApply,
		Label: "Create Atlas cards from reply",
		// ClassLocal: writes to Atlas's own persisted store, same
		// classification as apply-atlas-card-create. The clipboard
		// bridge's own taxonomy (clipbridge.MayAutoRun) already forces a
		// human review-accept BEFORE any run reaches this node -- the
		// items arriving here are the accepted subset, never the raw
		// reply.
		Effect:     guardrail.ClassLocal,
		Complexity: ComplexityAdvanced,
		Consumes:   []PayloadKind{PayloadNone},
		Produces:   PayloadProduce{Passthrough: true},
		Output:     "payload unchanged; a created-summary JSON -> the output attribute, if named",
		Description: "Creates Atlas records from an accepted clipboard reply's items: an item with a " +
			"\"title\" becomes a card of its named kind, an item with \"text\" becomes a Scratchpad note. " +
			"\"Items\" binds the attribute holding the accepted items as a JSON array.",
		ConfigFields: []ConfigField{
			{
				Key: "itemsAttribute", Label: "Items attribute", Type: FieldText,
				Description: "Which Attributes field carries the accepted reply items (a JSON array).",
			},
			{
				Key: "parentAttribute", Label: "Landing space attribute (optional)", Type: FieldText,
				Description: "Which Attributes field carries the target space's card id. New cards land there instead of the board root.",
			},
			{
				Key: "outputAttribute", Label: "Output attribute (optional)", Type: FieldText,
				Description: "Which Attributes field receives a summary of what was created.",
			},
		},
	}, execAtlasFromReply)
}

func execAtlasFromReply(node Node, ctx ExecContext) (ExecContext, error) {
	attr := node.Config["itemsAttribute"]
	if attr == "" {
		return ctx, fmt.Errorf("apply-atlas-from-reply: itemsAttribute is required")
	}
	raw, _ := ctx.Attributes[attr].(string)
	if raw == "" {
		return ctx, fmt.Errorf("apply-atlas-from-reply: attribute %q carries no items", attr)
	}
	var probe []json.RawMessage
	if err := json.Unmarshal([]byte(raw), &probe); err != nil {
		return ctx, fmt.Errorf("apply-atlas-from-reply: attribute %q is not a JSON array: %w", attr, err)
	}
	if len(probe) == 0 {
		return ctx, fmt.Errorf("apply-atlas-from-reply: attribute %q carries an empty item list", attr)
	}

	var parentID string
	if parentAttr := node.Config["parentAttribute"]; parentAttr != "" {
		parentID, _ = ctx.Attributes[parentAttr].(string)
	}

	summary, err := atlasReplyMaterializerFn(raw, parentID, currentRunID(ctx.RunContext))
	if err != nil {
		return ctx, fmt.Errorf("apply-atlas-from-reply: %w", err)
	}
	if outAttr := node.Config["outputAttribute"]; outAttr != "" {
		if ctx.Attributes == nil {
			ctx.Attributes = map[string]any{}
		}
		ctx.Attributes[outAttr] = summary
	}
	return ctx, nil
}
