package composition

import (
	"fmt"

	"github.com/alicoding/mill/internal/domain/guardrail"
	"github.com/alicoding/mill/internal/domain/list"
)

// applyListRowFn creates or updates a row in a Configure-authored List,
// matched by keyColumn's resolved value -- injected so this domain
// package never depends on configuresvc's storage (same seam shape as
// atlasCardCreateFn/atlasCardUpdateFn, this node's own write-path
// counterpart to lookupListFn's read). Typed-column validation happens
// on the wired side (configuresvc), which owns the List's Columns
// schema -- an invalid value is rejected before anything is persisted,
// never silently coerced. Defaults to erroring so a node run before
// SetApplyListRow is wired fails loudly.
var applyListRowFn = func(listID, keyColumn string, values map[string]string) (list.Row, error) {
	return list.Row{}, fmt.Errorf("no list row writer registered (yet) for id %q", listID)
}

// SetApplyListRow wires the function apply-list-row nodes use to
// create-or-update a row. Called once from main.go once ConfigureService
// exists.
func SetApplyListRow(fn func(listID, keyColumn string, values map[string]string) (list.Row, error)) {
	applyListRowFn = fn
}

func init() {
	RegisterNodeType(NodeType{
		ID: "apply-list-row", Kind: KindApply,
		Label: "Save list row",
		// ClassLocal: writes to a List's own persisted store, the same
		// local-write classification apply-atlas-card-create/update carry
		// (docs/goals/0066) -- guardrail-parkable via an explicit rule,
		// allowed by default like any other local write.
		Effect:     guardrail.ClassLocal,
		Complexity: ComplexityAdvanced,
		Consumes:   []PayloadKind{PayloadNone},
		Produces:   PayloadProduce{Passthrough: true},
		Output:     "payload unchanged; the row's id -> the output attribute, if named",
		Description: "Creates or updates a row in a Configure-authored List: if an existing row's \"Key " +
			"column\" value matches, only the fields named in \"Field values\" change (everything else on " +
			"that row is untouched); otherwise a new row is appended. \"Field values\" binds the List's own " +
			"declared column keys, each a literal or attr:<name> -- the same shape apply-atlas-card-create/" +
			"update use.",
		ConfigFields: []ConfigField{
			{
				Key: "listId", Label: "List", Type: FieldText, RefKind: "list",
				Description: "The Configure-authored List to write to.",
			},
			{
				Key: "keyColumn", Label: "Key column", Type: FieldText,
				Description: "Which column identifies a row -- an existing row whose value in this column matches gets updated; no match appends a new row.",
			},
			{
				Key: "fieldBindings", Label: "Field values", Type: FieldText, Multiline: true,
				Description: `JSON object mapping the List's column keys to a literal or attr:<name>, ` +
					`e.g. {"task":"attr:taskName","status":"Done"}. Must include a value for the key column.`,
			},
			{
				Key: "outputAttribute", Label: "Output attribute (optional)", Type: FieldText,
				Description: "Which Attributes field receives the row's id.",
			},
		},
	}, execApplyListRow)
}

func execApplyListRow(node Node, ctx ExecContext) (ExecContext, error) {
	listID := node.Config["listId"]
	if listID == "" {
		return ctx, fmt.Errorf("apply-list-row: listId is required")
	}
	keyColumn := node.Config["keyColumn"]
	if keyColumn == "" {
		return ctx, fmt.Errorf("apply-list-row: keyColumn is required")
	}
	bindings, err := parseBindings(node.Config["fieldBindings"])
	if err != nil {
		return ctx, fmt.Errorf("apply-list-row: fieldBindings: %w", err)
	}
	values := make(map[string]string, len(bindings))
	for k, raw := range bindings {
		values[k] = resolveBindingValue(raw, ctx.Attributes)
	}

	row, err := applyListRowFn(listID, keyColumn, values)
	if err != nil {
		return ctx, fmt.Errorf("apply-list-row: %w", err)
	}
	if outAttr := node.Config["outputAttribute"]; outAttr != "" {
		if ctx.Attributes == nil {
			ctx.Attributes = map[string]any{}
		}
		ctx.Attributes[outAttr] = row.ID
	}
	return ctx, nil
}
