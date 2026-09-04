package composition

import (
	"github.com/alicoding/mill/internal/domain/execenv"
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

	return []Workflow{
		{
			ID:          ExampleSecretGuardWorkflowID,
			Label:       "Example: uses a stored secret",
			Description: "Runs a command inside an execution environment configured with a stored secret (Configure > Execution Environments). A guardrail rule targets any step that uses a secret, so running this always asks for your approval first. Approve or deny it from this workflow's own Runs tab.",
			Nodes:       nodes,
			Edges: []Edge{
				{ID: "example-secret-guard-e0", Source: secretGuardTriggerID, Target: ExampleSecretGuardStepID},
			},
			BuiltIn: true,
			Seed:    seedorigin.Stamp(3),
		},
	}
}
