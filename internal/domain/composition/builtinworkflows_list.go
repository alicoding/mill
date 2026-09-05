package composition

import (
	"github.com/alicoding/mill/internal/domain/list"
	"github.com/alicoding/mill/internal/domain/seedorigin"
	"github.com/alicoding/mill/internal/domain/typedfield"
)

// builtInListWorkflows returns the two seeded workflows exercising
// List (docs/goals/0010 item 4, docs/goals/0011-lists-maturation.md
// item 4): list-lookup (the original, simpler exact-key lookup) and
// list-search (goal 0011's richer typed-Object successor), both
// against the same seeded "Country codes" List
// (internal/domain/list.BuiltIn). Split out of builtinworkflows.go
// once BuiltInWorkflows() crossed the 500-line convention -- see that
// function's own call site comment for the seam this follows.
func builtInListWorkflows() []Workflow {
	// List lookup (docs/goals/0010 item 4, docs/SPEC.md §3.3's List
	// row): a typed 'code' Attribute is read into the payload via
	// capture-attribute, then list-lookup resolves it against the
	// seeded "Country codes" List (Configure > Lists),
	// writing the match into a second, declared 'countryName'
	// Attribute -- the same "typed data flows through Attributes"
	// pattern the parent/child example already established.
	const (
		listTriggerID = "example-list-trigger"
		listCaptureID = "example-list-capture"
		listLookupID  = "example-list-lookup"
	)
	listNodes, err := ResolveNodeDefaults([]Node{
		{ID: listTriggerID, NodeTypeID: "trigger-manual", Position: Position{X: 0, Y: 0}},
		{ID: listCaptureID, NodeTypeID: "capture-attribute", Position: Position{X: 0, Y: 100},
			Config: map[string]string{"attribute": "code"}},
		{ID: listLookupID, NodeTypeID: "list-lookup", Position: Position{X: 0, Y: 200},
			Config: map[string]string{
				"listId": list.ExampleCountryCodesID, "inputKey": "code", "outputKey": "countryName",
			}},
	})
	if err != nil {
		panic("built-in workflow references an unknown node type: " + err.Error())
	}

	// List search (docs/goals/0011-lists-maturation.md item 4): the
	// richer successor to list-lookup above, against the same seeded
	// "Country codes" List (now typed, code/name columns).
	// Demonstrates a typed Object result (results/matched/first_match/
	// match_count/list_id) a downstream step could branch on, not just
	// a single scalar Attribute -- list-lookup's own seed above stays
	// untouched, proving the two coexist. Deliberately ends AT
	// list-search itself, mirroring list-lookup's own seed above,
	// rather than adding a terminal apply-clipboard-write-text step:
	// that step has no clipboard on a headless Linux CI runner
	// (docs/SPEC.md §1.3) and would only be exercising clipboard I/O
	// this seed isn't actually about -- caught by a real CI failure
	// (goal 0011's own PR), not assumed. A Process leaf is an accepted,
	// warn-only ending (ADR-0028), the same shape several other seeds
	// already use.
	const (
		listSearchTriggerID = "example-list-search-trigger"
		listSearchCaptureID = "example-list-search-capture"
		listSearchStepID    = "example-list-search-step"
	)
	const listSearchMatchParams = `[{"column":"code","value":"attr:code","matchType":"exact"}]`
	listSearchNodes, err := ResolveNodeDefaults([]Node{
		{ID: listSearchTriggerID, NodeTypeID: "trigger-manual", Position: Position{X: 0, Y: 0}},
		{ID: listSearchCaptureID, NodeTypeID: "capture-attribute", Position: Position{X: 0, Y: 100},
			Config: map[string]string{"attribute": "code"}},
		{ID: listSearchStepID, NodeTypeID: "list-search", Position: Position{X: 0, Y: 200},
			Config: map[string]string{
				"listId":          list.ExampleCountryCodesID,
				"matchParams":     listSearchMatchParams,
				"outputAttribute": "searchResult",
			}},
	})
	if err != nil {
		panic("built-in workflow references an unknown node type: " + err.Error())
	}

	return []Workflow{
		{
			ID:          "example-list-lookup-workflow",
			Label:       "Look up a client country",
			Description: "Looks up a typed country code in the Country codes list.",
			Nodes:       listNodes,
			Attributes: []AttributeDef{
				{Key: "code", Label: "Code", Type: FieldText},
				{Key: "countryName", Label: "Country name", Type: FieldText},
			},
			Edges: []Edge{
				{ID: "example-list-e0", Source: listTriggerID, Target: listCaptureID},
				{ID: "example-list-e1", Source: listCaptureID, Target: listLookupID},
			},
			BuiltIn: true,
			Seed:    seedorigin.Stamp(3),
		},
		{
			ID:          "example-list-search-workflow",
			Label:       "Search client countries",
			Description: "Searches the Country codes list and returns the matching record.",
			Nodes:       listSearchNodes,
			Attributes: []AttributeDef{
				{Key: "code", Label: "Code", Type: FieldText},
				{Key: "searchResult", Label: "Search result", Type: typedfield.TypeObject},
			},
			Edges: []Edge{
				{ID: "example-list-search-e0", Source: listSearchTriggerID, Target: listSearchCaptureID},
				{ID: "example-list-search-e1", Source: listSearchCaptureID, Target: listSearchStepID},
			},
			BuiltIn: true,
			Seed:    seedorigin.Stamp(4),
		},
	}
}
