package composition

import (
	"github.com/alicoding/mill/internal/domain/declaredsteptype"
	"github.com/alicoding/mill/internal/domain/seedorigin"
)

// builtInDeclaredStepTypeWorkflows is goal 0054 slice A's seeded proof
// for ADR-0037's data-backed step-type registry: a workflow using the
// seeded "Check httpbin" declared step type (declaredsteptype.BuiltIn)
// in place of a raw integration-http node picking its own requestId.
// Split into its own file (not appended to builtinworkflows.go) for
// the same 500-line reasoning builtinworkflows_list.go/
// builtinworkflows_ai.go's own header comments already give.
//
// Ordering hazard, documented rather than papered over: main.go
// constructs CompositionService (which calls this function, via
// BuiltInWorkflows -> restore/reconcileBuiltIns) before ConfigureService
// wires SetDeclaredNodeTypeLookup, so on that FIRST call the declared
// type isn't resolvable yet and ResolveNodeDefaults below returns an
// error -- unlike every sibling block in builtinworkflows.go, that is
// NOT a programming error to panic on here: this function returns nil
// (the workflow is simply absent from that call's result) rather than
// crashing startup. CompositionService.ReconcileBuiltIns, called a
// SECOND time from ConfigureService's constructor once the provider is
// wired (configureservice.go), re-evaluates BuiltInWorkflows() and
// inserts the now-resolvable entry on that later pass -- reconcile's
// own insert/upgrade/leave-alone/skip logic (compositionservice_
// seedlifecycle.go) needs no change to support this, since it always
// re-reads BuiltInWorkflows() fresh rather than caching an earlier call.
func builtInDeclaredStepTypeWorkflows() []Workflow {
	const (
		triggerID = "example-declared-step-trigger"
		stepID    = "example-declared-step-call"
	)
	nodes, err := ResolveNodeDefaults([]Node{
		{ID: triggerID, NodeTypeID: "trigger-manual", Position: Position{X: 0, Y: 0}},
		{ID: stepID, NodeTypeID: declaredsteptype.ExampleCheckHTTPBinID, Position: Position{X: 0, Y: 100}},
	})
	if err != nil {
		return nil
	}
	return []Workflow{
		{
			ID:          "example-declared-step-workflow",
			Label:       "Example: Declared step type",
			Description: "Runs the seeded \"Check httpbin\" step -- a named palette step bound to the seeded no-auth httpbin.org integration, promoted from a plain Integration: HTTP call step the same way the step designer promotes any HTTPRequest/MCP tool/child workflow. Its behavior is identical to that underlying step; only the palette presentation differs.",
			Nodes:       nodes,
			Edges: []Edge{
				{ID: "example-declared-step-e0", Source: triggerID, Target: stepID},
			},
			BuiltIn: true,
			Seed:    seedorigin.Stamp(1),
		},
	}
}
