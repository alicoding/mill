package composition

import (
	"github.com/alicoding/mill/internal/domain/list"
	"github.com/alicoding/mill/internal/domain/seedorigin"
)

// builtInListWriteWorkflows returns the seeded proof for goal 0070's
// write path: apply-list-row against the seeded "Example: Task
// tracker" List (internal/domain/list.BuiltIn). Split out of
// builtinworkflows.go the same "split along a real seam" way every
// other builtinworkflows_*.go file already follows -- List's own read
// path already has its file (builtinworkflows_list.go); the write path
// is a distinct, self-contained addition.
func builtInListWriteWorkflows() []Workflow {
	const (
		triggerID = "example-list-write-trigger"
		createID  = "example-list-write-create"
		updateID  = "example-list-write-update"
	)
	nodes, err := ResolveNodeDefaults([]Node{
		{ID: triggerID, NodeTypeID: "trigger-manual", Position: Position{X: 0, Y: 0}},
		{ID: createID, NodeTypeID: "apply-list-row", Position: Position{X: 0, Y: 100},
			Config: map[string]string{
				"listId": list.ExampleTaskTrackerID, "keyColumn": "task",
				"fieldBindings": `{"task":"Ship goal 0070","status":"In progress"}`,
			}},
		{ID: updateID, NodeTypeID: "apply-list-row", Position: Position{X: 0, Y: 200},
			Config: map[string]string{
				"listId": list.ExampleTaskTrackerID, "keyColumn": "task",
				"fieldBindings": `{"task":"Ship goal 0070","status":"Done"}`,
			}},
	})
	if err != nil {
		panic("built-in workflow references an unknown node type: " + err.Error())
	}

	// Version pin (docs/adr/0040 decisions 4-5, applied to List by goal
	// 0070): the seeded "Example: Task tracker" List is published once
	// at v1 (list.BuiltIn's own seed data -- just the "Set up Mill"
	// row). This step pins to that exact snapshot, so running the
	// create/update workflow above (which adds a live-only "Ship goal
	// 0070" row) never changes what this step resolves.
	const (
		pinnedTriggerID = "example-list-pinned-trigger"
		pinnedSearchID  = "example-list-pinned-search"
	)
	pinnedNodes, err := ResolveNodeDefaults([]Node{
		{ID: pinnedTriggerID, NodeTypeID: "trigger-manual", Position: Position{X: 0, Y: 0}},
		{ID: pinnedSearchID, NodeTypeID: "list-search", Position: Position{X: 0, Y: 100},
			Config: map[string]string{
				"listId": list.ExampleTaskTrackerID, "version": "1",
				"matchParams":     `[{"column":"task","value":"Ship goal 0070","matchType":"exact"}]`,
				"outputAttribute": "pinnedResult",
			}},
	})
	if err != nil {
		panic("built-in workflow references an unknown node type: " + err.Error())
	}

	return []Workflow{
		{
			ID:    "example-list-write-workflow",
			Label: "Example: Track in a list",
			Description: "Adds a row to the seeded \"Example: Task tracker\" List (Configure > Lists), then " +
				"updates that same row's status. The first step's key has no matching row yet, so it " +
				"creates one; the second step's identical key matches what the first step just wrote, " +
				"so it updates in place. Run it again to see the same row updated rather than duplicated.",
			Nodes: nodes,
			Edges: []Edge{
				{ID: "example-list-write-e0", Source: triggerID, Target: createID},
				{ID: "example-list-write-e1", Source: createID, Target: updateID},
			},
			BuiltIn: true,
			Seed:    seedorigin.Stamp(2),
		},
		{
			ID:    "example-list-pinned-workflow",
			Label: "Example: Task tracker (pinned to v1)",
			Description: "Searches the seeded \"Example: Task tracker\" List for a row this workflow's own " +
				"write-path example may have added since publish. Pinned to v1, it never matches, no " +
				"matter how many rows \"Example: Track in a list\" has since appended to the live List.",
			Nodes: pinnedNodes,
			Edges: []Edge{
				{ID: "example-list-pinned-e0", Source: pinnedTriggerID, Target: pinnedSearchID},
			},
			BuiltIn: true,
			Seed:    seedorigin.Stamp(2),
		},
	}
}
