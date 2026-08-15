package composition

import "github.com/alicoding/mill/internal/domain/seedorigin"

// builtInStepFailureWorkflows is goal 0051 item 3's own seeded proof:
// a workflow that fails, deterministically and on purpose, every time
// it's run, so Activity's step-type failure breakdown has real data to
// render from a fresh install (testing.md's "seed IS the proof").
// list-lookup is picked over code-execution specifically because its
// Effect is ClassRead (guardrail.DefaultEffect: default-allow, no
// approval gate) -- a manual Run click fails immediately, with no
// parked-approval detour to script around. Split into its own file for
// the same 500-line reasoning builtinworkflows_list.go/
// builtinworkflows_declaredsteptype.go's own header comments already
// give.
func builtInStepFailureWorkflows() []Workflow {
	const (
		triggerID = "example-step-failure-trigger"
		lookupID  = "example-step-failure-lookup"
	)
	nodes, err := ResolveNodeDefaults([]Node{
		{ID: triggerID, NodeTypeID: "trigger-manual", Position: Position{X: 0, Y: 0}},
		{ID: lookupID, NodeTypeID: "list-lookup", Position: Position{X: 0, Y: 100},
			Config: map[string]string{
				// "does-not-exist" is never a real Configure-authored List
				// ID -- resolveList's own lookup fails deterministically,
				// no Configure setup or network call required.
				"listId": "does-not-exist", "inputKey": "code", "outputKey": "match", "onMiss": "fail",
			}},
	})
	if err != nil {
		panic("built-in workflow references an unknown node type: " + err.Error())
	}
	return []Workflow{
		{
			ID:          "example-step-failure-workflow",
			Label:       "Example: Step failure",
			Description: "Fails on purpose every time it runs -- looks up a list that was never configured, so this step always errors. Run it to see a failure show up in Activity's failure breakdown by step type.",
			Nodes:       nodes,
			Edges: []Edge{
				{ID: "example-step-failure-e0", Source: triggerID, Target: lookupID},
			},
			BuiltIn: true,
			Seed:    seedorigin.Stamp(1),
		},
	}
}
