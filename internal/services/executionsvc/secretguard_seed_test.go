package executionsvc

import (
	"testing"
	"time"

	"github.com/alicoding/mill/internal/services/guardrailsvc"
)

// swapSecretLabelsLookup mirrors swapExecEnvLookup/swapHTTPRequestLookup
// (codeexec_seed_test.go/guardedhttp_seed_test.go): guardrailsvc.
// SetSecretLabelsLookup is a package-level var with no test-scoped
// accessor, so this file owns its own swap/restore discipline.
func swapSecretLabelsLookup(t *testing.T, fn func(nodeTypeID string, config map[string]string) []string) {
	t.Helper()
	guardrailsvc.SetSecretLabelsLookup(fn)
	t.Cleanup(func() {
		guardrailsvc.SetSecretLabelsLookup(func(string, map[string]string) []string { return nil })
	})
}

// TestSeededSecretGuardWorkflow_ParksWithSecretsRuleLabel proves goal
// 0203 S2's own seeded proof end to end: the real seeded "Example: uses
// a stored secret" workflow, evaluated against the real seeded
// guardrail rule (guardrail.BuiltIn, reconciled in by
// newTestExecutionService's own GuardrailService construction) parks
// with THAT rule's own label -- not the code-execution NodeType's
// generic external-effect default-ask (which carries no label at all,
// codeexec_seed_test.go's own sibling seed proves that baseline).
//
// The derivation seam itself (configuresvc.DeriveSecretLabels reading a
// real ExecEnv's "vault:" reference) is unit-tested directly in
// internal/services/configuresvc/secretattr_test.go; executionsvc
// doesn't depend on configuresvc (.claude/rules/backend.md), so this
// swaps in a fake mirroring its real output shape for this seed's own
// node, same "fake the entity-lookup seam, prove the graph/execution
// mechanics for real" pattern swapExecEnvLookup already establishes.
func TestSeededSecretGuardWorkflow_ParksWithSecretsRuleLabel(t *testing.T) {
	exec, comp := newTestExecutionService(t)
	swapSecretLabelsLookup(t, func(nodeTypeID string, config map[string]string) []string {
		if nodeTypeID == "code-execution" && config["envId"] == "example-secret-guard-execenv" {
			return []string{"unrecognized vault entry"}
		}
		return nil
	})

	wfID := findBuiltInWorkflowID(t, comp, "Example: uses a stored secret")

	summary, err := exec.RunWorkflow(wfID, RunKindTest, nil)
	if err != nil {
		t.Fatalf("RunWorkflow: %v", err)
	}

	pending := waitFor(t, "pending approval", 10*time.Second, func() (*PendingApproval, bool) {
		s, err := exec.summaryFor(summary.RunID)
		if err != nil || s.Pending == nil {
			return nil, false
		}
		return s.Pending, true
	})
	if pending.NodeTypeID != "code-execution" {
		t.Fatalf("pending.NodeTypeID = %q, want code-execution", pending.NodeTypeID)
	}
	if pending.RuleLabel != "Uses a stored secret" {
		t.Errorf("pending.RuleLabel = %q, want the seeded rule's own label %q", pending.RuleLabel, "Uses a stored secret")
	}

	if err := exec.ResolveApproval(summary.RunID, pending.NodeID, false, nil, false); err != nil {
		t.Fatalf("ResolveApproval(deny): %v", err)
	}
	waitFor(t, "run to fail", 10*time.Second, func() (RunSummary, bool) {
		s, err := exec.summaryFor(summary.RunID)
		if err != nil || (s.Status != "ERROR" && s.Status != "MAX_RECOVERY_ATTEMPTS_EXCEEDED") {
			return RunSummary{}, false
		}
		return s, true
	})
}
