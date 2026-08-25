package guardrail

import "github.com/alicoding/mill/internal/domain/seedorigin"

// ExampleSecretGuardRuleID is the seeded example guardrail rule's ID --
// exported so a test/UI affordance can reference it without a string
// literal that could drift, same pattern mcpserver.ExampleReferenceServerID
// et al. already establish.
const ExampleSecretGuardRuleID = "example-secret-guard-rule"

// exampleSecretGuardWorkflowID/exampleSecretGuardStepID mirror
// composition.ExampleSecretGuardWorkflowID/ExampleSecretGuardStepID
// (internal/domain/composition/builtinworkflows_secretguard.go) as
// literal strings rather than an import: composition already imports
// this package (decisionoutcome.go's NodeAlwaysParks/EffectForNode), so
// a guardrail -> composition import back would cycle.
const (
	exampleSecretGuardWorkflowID = "example-secret-guard-workflow"
	exampleSecretGuardStepID     = "example-secret-guard-step"
)

// BuiltIn returns the seeded example guardrail rule -- goal 0203 S2's
// own proof that a step's derived secret use (Attributes["secrets"],
// GuardrailStep in guardrailservice.go) is visible to a real rule
// condition. Scoped to the seeded "Example: uses a stored secret"
// workflow's own step, never to a NodeType broadly, so this can never
// change any pre-existing or user-authored workflow's behavior.
func BuiltIn() []Rule {
	return []Rule{
		{
			ID:         ExampleSecretGuardRuleID,
			Label:      "Uses a stored secret",
			Effect:     EffectAsk,
			WorkflowID: exampleSecretGuardWorkflowID,
			NodeID:     exampleSecretGuardStepID,
			Condition:  `len(Attributes["secrets"]) > 0`,
			BuiltIn:    true,
			Seed:       seedorigin.Stamp(1),
		},
	}
}
