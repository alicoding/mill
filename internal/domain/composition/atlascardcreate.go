package composition

import (
	"fmt"

	"github.com/alicoding/mill/internal/domain/guardrail"
)

// atlasCardCreateFn creates a new Atlas card -- injected so this domain
// package never depends on atlassvc's storage (.claude/rules/backend.md).
// sourceRunID is the writing run's own id (currentRunID, ""  outside a
// run) -- threaded through so the trigger cycle guard (docs/goals/0066)
// can tell a run's own write to its source card apart from any other
// write, entirely on the trigger-dispatch side; this domain package
// never inspects it itself. Defaults to erroring so a node run before
// SetAtlasCardCreator is wired fails loudly.
var atlasCardCreateFn = func(kindID, title string, fields map[string]string, sourceRunID string) (AtlasCard, error) {
	return AtlasCard{}, fmt.Errorf("no atlas card creator registered (yet) for kind %q", kindID)
}

// SetAtlasCardCreator wires the function apply-atlas-card-create nodes
// use to create a card. Called once from main.go once AtlasService
// exists.
func SetAtlasCardCreator(fn func(kindID, title string, fields map[string]string, sourceRunID string) (AtlasCard, error)) {
	atlasCardCreateFn = fn
}

func init() {
	RegisterNodeType(NodeType{
		ID: "apply-atlas-card-create", Kind: KindApply,
		Label: "Atlas: create card",
		// ClassLocal: writes to Atlas's own persisted store, the native
		// baseline a person already performs by hand from the Atlas
		// surface itself -- same classification apply-file-write/
		// apply-clipboard-write-* carry (docs/adr/0022).
		Effect: guardrail.ClassLocal,
		// Advanced: fieldBindings is hand-authored JSON against the
		// target Kind's own schema, same reasoning child-workflow's
		// inputBindings carries.
		Complexity: ComplexityAdvanced,
		Output:     "payload unchanged; the new card's id -> the output attribute, if named",
		Description: "Creates a new card in Atlas of the chosen Kind. \"Field values\" binds the Kind's own " +
			"declared fields, each a literal or attr:<name>.",
		ConfigFields: []ConfigField{
			{
				Key: "kindId", Label: "Kind", Type: FieldText, RefKind: "atlas-kind",
				Description: "Which Atlas card kind to create.",
			},
			{
				Key: "title", Label: "Title", Type: FieldText,
				Description: "The new card's title -- a literal or attr:<name>.",
			},
			{
				Key: "fieldBindings", Label: "Field values", Type: FieldText, Multiline: true,
				Description: `JSON object mapping the Kind's field keys to a literal or attr:<name>, ` +
					`e.g. {"status":"New","owner":"attr:currentUser"}.`,
			},
			{
				Key: "outputAttribute", Label: "Output attribute (optional)", Type: FieldText,
				Description: "Which Attributes field receives the new card's id, so a later step can " +
					"reference it (e.g. to link it or update it further).",
			},
		},
	}, execAtlasCardCreate)
}

func execAtlasCardCreate(node Node, ctx ExecContext) (ExecContext, error) {
	kindID := node.Config["kindId"]
	if kindID == "" {
		return ctx, fmt.Errorf("apply-atlas-card-create: kindId is required")
	}
	title := resolveBindingValue(node.Config["title"], ctx.Attributes)
	if title == "" {
		return ctx, fmt.Errorf("apply-atlas-card-create: title is required")
	}
	bindings, err := parseBindings(node.Config["fieldBindings"])
	if err != nil {
		return ctx, fmt.Errorf("apply-atlas-card-create: fieldBindings: %w", err)
	}
	fields := make(map[string]string, len(bindings))
	for k, raw := range bindings {
		fields[k] = resolveBindingValue(raw, ctx.Attributes)
	}

	card, err := atlasCardCreateFn(kindID, title, fields, currentRunID(ctx.RunContext))
	if err != nil {
		return ctx, fmt.Errorf("apply-atlas-card-create: %w", err)
	}
	if outAttr := node.Config["outputAttribute"]; outAttr != "" {
		if ctx.Attributes == nil {
			ctx.Attributes = map[string]any{}
		}
		ctx.Attributes[outAttr] = card.ID
	}
	return ctx, nil
}
