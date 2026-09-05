package composition

import (
	"testing"

	"github.com/alicoding/mill/internal/domain/environment"
)

// The Environment family's half of the seed-proof registry
// (seedproof_test.go's own doc comment carries the mechanism and the
// reasoning) -- its own file purely to keep that one under the
// 500-line convention.

// environmentProofRegistry: every environment.BuiltIn() ID.
var environmentProofRegistry = map[string]seedProof{
	environment.ExampleSandboxID: proven(
		"configuresvc.TestResolveEnvironment_PlainAndSecretVariables",
		"configuresvc.TestEnvironmentVarGap_SeededRequestResolvesOnlyInSandbox",
		"executionsvc.TestSeededGuardedHTTPWorkflow_ApproveFiresRealHTTPCall",
		"e2e: configure-environments.spec.ts",
	),
	environment.ExampleProductionID: proven(
		"configuresvc.TestEnvironmentVarGap_SeededRequestResolvesOnlyInSandbox",
		"configuresvc.TestDeleteEnvironment_RefusedWhileAWorkflowDefaultsToIt",
	),
}

func TestSeedProofRegistry_EveryEnvironmentProvenOrExempt(t *testing.T) {
	envs := environment.BuiltIn()
	ids := make([]string, 0, len(envs))
	for _, e := range envs {
		ids = append(ids, e.ID)
	}
	checkRegistry(t, "seeded Environment", ids, environmentProofRegistry)
}
