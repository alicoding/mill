package composition

import "fmt"

// ResolvedList is a List's entries, assembled by whatever owns List
// storage at request time. Same shape and same reasoning as
// ResolvedConnector (integration.go): composition.go doesn't own List
// persistence (ConfigureService does), so this is injected once via
// SetListLookup rather than composition depending on ConfigureService
// directly.
type ResolvedList struct {
	Entries map[string]string
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
		Description: "Looks up an Attributes value in a Configure-authored List and writes the matched entry back into Attributes. listId is FieldText for the same reason integration-http's connectorId is above -- Lists are runtime, Configure-authored data (the Inspector renders a live picker for it, RefKind, docs/adr/0009).",
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
		},
	}, func(node Node, ctx ExecContext) (ExecContext, error) {
		rl, err := lookupListFn(node.Config["listId"])
		if err != nil {
			return ctx, fmt.Errorf("list-lookup: %w", err)
		}

		inputVal := fmt.Sprintf("%v", ctx.Attributes[node.Config["inputKey"]])
		matched, ok := rl.Entries[inputVal]
		if !ok {
			return ctx, fmt.Errorf("list-lookup: no entry for %q", inputVal)
		}
		ctx.Attributes[node.Config["outputKey"]] = matched
		return ctx, nil
	})
}
