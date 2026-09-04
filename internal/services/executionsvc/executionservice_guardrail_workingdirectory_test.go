package executionsvc

import (
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/alicoding/mill/internal/services/compositionsvc"
	"github.com/alicoding/mill/internal/services/guardrailsvc"
	"github.com/alicoding/mill/internal/services/servicetest"
)

// TestGuardrail_ShellStepWorkingDirectory_PreviewedInPendingPayload
// proves goal 0345's approval-preview line: an external-effect shell
// step carrying a workingDirectory override advertises the resolved
// directory on its PendingApproval.Payload, ahead of the step's own
// command text -- an approver sees WHERE a step runs before deciding.
func TestGuardrail_ShellStepWorkingDirectory_PreviewedInPendingPayload(t *testing.T) {
	store := servicetest.NewFakeStore()
	comp := compositionsvc.NewCompositionService(store)
	guard := guardrailsvc.NewGuardrailService(store, comp)
	dbPath := filepath.Join(t.TempDir(), "exec.db")
	exec, err := NewExecutionService("sqlite:"+dbPath, comp, guard)
	if err != nil {
		t.Fatalf("NewExecutionService: %v", err)
	}
	t.Cleanup(func() { _ = exec.Shutdown(2 * time.Second) })

	dir := t.TempDir()
	wf, err := comp.CreateWorkflow("Working directory preview test", "", []composition.Node{
		{ID: "t1", NodeTypeID: "trigger-manual", Position: composition.Position{X: 0, Y: 0}},
		{ID: "n1", NodeTypeID: "process-shell-command", Position: composition.Position{X: 0, Y: 120},
			Config: map[string]string{"workingDirectory": dir}},
	}, []composition.Edge{{ID: "e1", Source: "t1", Target: "n1"}})
	if err != nil {
		t.Fatalf("CreateWorkflow: %v", err)
	}

	summary, err := exec.RunWorkflowWithPayload(wf.ID, RunKindTest, nil, "pwd")
	if err != nil {
		t.Fatalf("RunWorkflowWithPayload: %v", err)
	}

	pending := waitFor(t, "pending approval", 10*time.Second, func() (*PendingApproval, bool) {
		s, err := exec.summaryFor(summary.RunID)
		if err != nil || s.Pending == nil {
			return nil, false
		}
		return s.Pending, true
	})

	wantPrefix := "Working directory: " + dir + "\n\n"
	if !strings.HasPrefix(pending.Payload, wantPrefix) {
		t.Fatalf("pending.Payload = %q, want it to start with %q", pending.Payload, wantPrefix)
	}
	if !strings.Contains(pending.Payload, "pwd") {
		t.Errorf("pending.Payload = %q, want the step's own command text still present", pending.Payload)
	}

	if err := exec.ResolveApproval(summary.RunID, "n1", false, nil, false); err != nil {
		t.Fatalf("ResolveApproval: %v", err)
	}
}
