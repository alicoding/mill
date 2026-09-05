package composition

import (
	"github.com/alicoding/mill/internal/domain/execenv"
	"github.com/alicoding/mill/internal/domain/httprequest"
	"github.com/alicoding/mill/internal/domain/seedorigin"
)

// ExampleSecretGuardWorkflowID/ExampleSecretGuardStepID are exported so
// a test/UI affordance can reference this seeded workflow's own step
// without a string literal that could drift -- same convention every
// other builtinworkflows_*.go split file already establishes. Also
// mirrored (as unexported literals, not an import) by guardrail.
// BuiltIn's own seeded rule: guardrail can't import this package, since
// this package already imports guardrail (decisionoutcome.go's
// NodeAlwaysParks/EffectForNode) and a guardrail -> composition import
// back would cycle.
const (
	ExampleSecretGuardWorkflowID = "example-secret-guard-workflow"
	ExampleSecretGuardStepID     = "example-secret-guard-step"
	// ExampleScheduledSecretReadWorkflowID/StepID name goal 0360 S2's
	// seeded proof: a scheduled step that reads a stored secret, so a
	// locked vault makes it wait in Review instead of failing.
	ExampleScheduledSecretReadWorkflowID = "example-scheduled-secret-read-workflow"
	ExampleScheduledSecretReadStepID     = "example-scheduled-secret-read-step"
)

// builtInSecretGuardWorkflows returns goal 0203 S2's own seeded proof:
// a code-execution step whose ExecEnv (execenv.ExampleSecretGuardID)
// carries a "vault:" reference, paired with a seeded guardrail rule
// (guardrail.BuiltIn, scoped to this exact workflow/step) conditioned
// on Attributes["secrets"] -- running this always asks, with THAT
// rule's own label, proving the derived attribute is visible to a real
// rule condition before anyone runs anything (WorkflowVerdicts computes
// the identical answer for the canvas badge). Split out of
// builtinworkflows.go once BuiltInWorkflows() crossed the 500-line
// convention -- see that function's own call site comment for the seam
// this follows.
func builtInSecretGuardWorkflows() []Workflow {
	const secretGuardTriggerID = "example-secret-guard-trigger"

	nodes, err := ResolveNodeDefaults([]Node{
		{ID: secretGuardTriggerID, NodeTypeID: "trigger-manual", Position: Position{X: 0, Y: 0}},
		{ID: ExampleSecretGuardStepID, NodeTypeID: "code-execution", Position: Position{X: 0, Y: 100},
			Config: map[string]string{
				"envId": execenv.ExampleSecretGuardID, "source": "literal",
				"script": `echo "hello from mill"`, "timeoutSeconds": "30",
			}},
	})
	if err != nil {
		panic("built-in workflow references an unknown node type: " + err.Error())
	}

	const scheduledSecretReadTriggerID = "example-scheduled-secret-read-trigger"
	scheduledNodes, err := ResolveNodeDefaults([]Node{
		{ID: scheduledSecretReadTriggerID, NodeTypeID: "trigger-schedule", Position: Position{X: 0, Y: 0},
			Config: map[string]string{"cron": "*/15 * * * *"}},
		{ID: ExampleScheduledSecretReadStepID, NodeTypeID: "integration-http", Position: Position{X: 0, Y: 100},
			Config: map[string]string{"requestId": httprequest.ExampleAPIKeyID}},
	})
	if err != nil {
		panic("built-in workflow references an unknown node type: " + err.Error())
	}

	return []Workflow{
		{
			// Goal 0360 S2's seeded proof: the request's API key is a
			// stored secret, so with the vault locked this run parks in
			// Review as "Waiting for the vault to unlock" and continues
			// on unlock. Disabled like every seeded external example --
			// its schedule only arms once someone turns it on.
			ID:          ExampleScheduledSecretReadWorkflowID,
			Label:       "Example: Scheduled read of a secret",
			Description: "Every 15 minutes, calls the API key header example (Configure > Requests), whose key is a stored secret. If the vault is locked when it fires, the run waits in Review until you unlock the vault, then continues from that step. Run it by hand with the vault locked to see the wait. External steps ask for approval first unless a rule allows them.",
			Nodes:       scheduledNodes,
			Edges: []Edge{
				{ID: "example-scheduled-secret-read-e0", Source: scheduledSecretReadTriggerID, Target: ExampleScheduledSecretReadStepID},
			},
			BuiltIn:  true,
			Disabled: true,
			Seed:     seedorigin.Stamp(1),
		},
		{
			ID:          ExampleSecretGuardWorkflowID,
			Label:       "Example: uses a stored secret",
			Description: "Runs a command inside an execution environment configured with a stored secret (Configure > Execution Environments). A guardrail rule targets any step that uses a secret, so running this always asks for your approval first. Approve or deny it from this workflow's own Runs tab.",
			Nodes:       nodes,
			Edges: []Edge{
				{ID: "example-secret-guard-e0", Source: secretGuardTriggerID, Target: ExampleSecretGuardStepID},
			},
			BuiltIn: true,
			// Revision 4 (goal 0345): code-execution gained a
			// workingDirectory ConfigField, whose default-filled "" now
			// lands in this seed's own persisted Config too
			// (ResolveNodeDefaults fills every declared field).
			Seed: seedorigin.Stamp(4),
		},
	}
}
