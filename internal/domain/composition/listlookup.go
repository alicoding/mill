package composition

import (
	"fmt"

	"github.com/alicoding/mill/internal/domain/guardrail"
	"github.com/alicoding/mill/internal/domain/list"
	"github.com/alicoding/mill/internal/domain/typedfield"
)

// ResolvedList is a List's data, assembled by whatever owns List
// storage at request time. Same shape and same reasoning as
// ResolvedHTTPRequest (integration.go): composition.go doesn't own List
// persistence (ConfigureService does), so this is injected once via
// SetListLookup rather than composition depending on ConfigureService
// directly.
//
// Entries stays list-lookup's own flat key/value read -- the
// resolver's own list.DeriveEntries output (goal 0011), computed
// once at resolve time so list-lookup's execution logic here needed
// zero changes when List grew typed columns. Columns/Rows are goal
// 0011's typed additions, read by list-search (listsearch.go).
type ResolvedList struct {
	Entries map[string]string
	Columns []typedfield.Field
	Rows    []list.Row
}

// lookupListFn defaults to erroring so a list-lookup node run before
// ConfigureService exists (or before SetListLookup wires it) fails
// loudly instead of silently no-op'ing.
var lookupListFn = func(listID string) (ResolvedList, error) {
	return ResolvedList{}, fmt.Errorf("no list lookup registered (yet) for id %q", listID)
}

// SetListLookup wires the function list-lookup nodes use to resolve a
// listId into its entries. Called once from main.go once ConfigureService
// exists.
func SetListLookup(fn func(listID string) (ResolvedList, error)) {
	lookupListFn = fn
}

func init() {
	RegisterNodeType(NodeType{
		ID: "list-lookup", Kind: KindProcess,
		Label:       "List: lookup",
		// ClassRead: resolves a Configure-authored List's persisted
		// entries (lookupListFn) -- the same "reads state outside this
		// workflow's own payload/Attributes" classification capture-file
		// declares for a local filesystem read, not left at the zero
		// value (docs/goals/0030-node-standard.md item b).
		Effect:      guardrail.ClassRead,
		Output:      "payload unchanged; match → attribute",
		Description: "Looks up an Attributes value in a Configure-authored List and writes the matched entry back into Attributes. listId is FieldText for the same reason integration-http's requestId is above -- Lists are runtime, Configure-authored data (the Inspector renders a live picker for it, RefKind, docs/adr/0009).",
		ConfigFields: []ConfigField{
			{
				Key: "listId", Label: "List ID",
				Description: "The ID of a list configured on the Configure page.",
				Default:     "", Type: FieldText, RefKind: "list",
			},
			{
				Key: "inputKey", Label: "Input attribute",
				Description: "Which Attributes field's value to look up.",
				Default:     "", Type: FieldText,
			},
			{
				Key: "outputKey", Label: "Output attribute",
				Description: "Which Attributes field the matched value gets written to.",
				Default:     "", Type: FieldText,
			},
			{
				// Explicit miss behavior (goal 0001 node maturity): the
				// old node always failed the run on a miss, with no way
				// to say "that's fine, continue." Default stays "fail" so
				// every persisted node behaves exactly as before.
				Key: "onMiss", Label: "If no match", Type: FieldOptions,
				Description: "What to do when the input value isn't in the list.",
				Default:     "fail",
				Options:     []string{"fail", "continue", "default"},
			},
			{
				Key: "defaultValue", Label: "Default value",
				Description: "Written to the output attribute when there's no match and \"If no match\" is \"default\".",
				Default:     "", Type: FieldText,
			},
		},
	}, func(node Node, ctx ExecContext) (ExecContext, error) {
		rl, err := lookupListFn(node.Config["listId"])
		if err != nil {
			return ctx, fmt.Errorf("list-lookup: %w", err)
		}

		inputVal := fmt.Sprintf("%v", ctx.Attributes[node.Config["inputKey"]])
		matched, ok := rl.Entries[inputVal]
		if !ok {
			switch node.Config["onMiss"] {
			case "continue":
				// Leave Attributes unchanged, proceed -- an explicit
				// "a miss is fine" (goal 0001).
				return ctx, nil
			case "default":
				ctx.Attributes[node.Config["outputKey"]] = node.Config["defaultValue"]
				return ctx, nil
			default: // "fail" and any legacy-empty value
				return ctx, fmt.Errorf("list-lookup: no entry for %q", inputVal)
			}
		}
		ctx.Attributes[node.Config["outputKey"]] = matched
		return ctx, nil
	})
}
