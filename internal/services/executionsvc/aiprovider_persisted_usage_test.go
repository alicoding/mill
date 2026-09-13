package executionsvc

import (
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/alicoding/mill/internal/adapters/dataownership"
	"github.com/alicoding/mill/internal/adapters/execution"
	"github.com/alicoding/mill/internal/domain/aiprovider"
	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/alicoding/mill/internal/services/compositionsvc"
	"github.com/alicoding/mill/internal/services/guardrailsvc"
	"github.com/alicoding/mill/internal/services/servicetest"
	"github.com/google/uuid"
)

func newAIProviderUsageHarness(t *testing.T) (*ExecutionService, func()) {
	t.Helper()
	store := servicetest.NewFakeStore()
	comp := compositionsvc.NewCompositionService(store)
	exec, err := NewExecutionService(
		"sqlite:"+filepath.Join(t.TempDir(), "provider-usage.db"),
		comp,
		guardrailsvc.NewGuardrailService(store, comp),
	)
	if err != nil {
		t.Fatalf("NewExecutionService: %v", err)
	}
	exec.aiProviderMutation = newAIProviderMutationState(dataownership.ExecutionOwnershipPrivateMemory)
	var once sync.Once
	shutdown := func() {
		once.Do(func() {
			if err := exec.Shutdown(2 * time.Second); err != nil {
				t.Errorf("Shutdown: %v", err)
			}
		})
	}
	t.Cleanup(shutdown)
	return exec, shutdown
}

func providerUsageRunInput(workflowID, providerID string) runInput {
	nodes := []composition.Node{{ID: "trigger", NodeTypeID: "trigger-manual"}}
	if providerID != "" {
		nodes = append(nodes, composition.Node{
			ID: "ai", NodeTypeID: "process-ai-completion",
			Config: map[string]string{"aiproviderId": providerID},
		})
	}
	return runInput{WorkflowID: workflowID, Nodes: nodes, Kind: RunKindTest}
}

func enqueueProviderUsageRun(
	t *testing.T,
	exec *ExecutionService,
	queue execution.Queue,
	in runInput,
	opts ...execution.WorkflowOption,
) string {
	t.Helper()
	runID := uuid.NewString()
	opts = append([]execution.WorkflowOption{execution.WithWorkflowID(runID), execution.WithQueue(queue)}, opts...)
	if _, err := execution.RunWorkflow(exec.ctx, exec.runWorkflow, in, opts...); err != nil {
		t.Fatalf("RunWorkflow(%s): %v", runID, err)
	}
	return runID
}

func awaitPersistedWorkflowStatus(t *testing.T, exec *ExecutionService, runID string, want execution.WorkflowStatusType) {
	t.Helper()
	waitFor(t, "workflow "+runID+" status "+string(want), 10*time.Second, func() (struct{}, bool) {
		rows, err := execution.ListWorkflows(exec.ctx,
			execution.WithFilterWorkflowIDs(runID),
			execution.WithFilterLoadInput(false),
			execution.WithFilterLoadOutput(false),
		)
		return struct{}{}, err == nil && len(rows) == 1 && rows[0].Status == want
	})
}

func cancelProviderUsageRuns(t *testing.T, exec *ExecutionService, runIDs []string) {
	t.Helper()
	for _, runID := range runIDs {
		if err := execution.CancelWorkflow(exec.ctx, runID); err != nil {
			t.Errorf("CancelWorkflow(%s): %v", runID, err)
			continue
		}
		awaitPersistedWorkflowStatus(t, exec, runID, execution.WorkflowStatusCancelled)
	}
}

func impactHasBlocker(impact aiprovider.ChangeImpact, want aiprovider.ChangeBlockerCode) bool {
	for _, blocker := range impact.BlockerCodes {
		if blocker == want {
			return true
		}
	}
	return false
}

func TestAIProviderChangeImpactFindsPersistedUseBeyondFiftyNewerRows(t *testing.T) {
	exec, _ := newAIProviderUsageHarness(t)
	queue, err := execution.RegisterQueue(exec.ctx, "provider-impact-more-than-fifty", execution.WithWorkerConcurrency(0))
	if err != nil {
		t.Fatalf("RegisterQueue: %v", err)
	}

	const providerID = "provider-beyond-fifty"
	runIDs := make([]string, 0, 1)
	t.Cleanup(func() { cancelProviderUsageRuns(t, exec, runIDs) })
	providerRunID := enqueueProviderUsageRun(t, exec, queue, providerUsageRunInput("uses-provider", providerID))
	runIDs = append(runIDs, providerRunID)
	for i := 0; i < 51; i++ {
		runIDs = append(runIDs, enqueueProviderUsageRun(t, exec, queue, providerUsageRunInput("does-not-use-provider", "")))
	}
	for _, runID := range runIDs {
		awaitPersistedWorkflowStatus(t, exec, runID, execution.WorkflowStatusEnqueued)
	}

	impact := AIProviderChangeImpact(exec, providerID, func() string { return "revision-1" })
	if impact.MutationAllowed || !impactHasBlocker(impact, aiprovider.ChangeBlockerProviderInUse) {
		t.Fatalf("impact = %+v, want provider-in-use refusal", impact)
	}
	if len(impact.RunIDs) != 1 || impact.RunIDs[0] != providerRunID {
		t.Fatalf("impact.RunIDs = %v, want only oldest provider run %s", impact.RunIDs, providerRunID)
	}
	if len(impact.WorkflowIDs) != 1 || impact.WorkflowIDs[0] != "uses-provider" {
		t.Fatalf("impact.WorkflowIDs = %v, want uses-provider", impact.WorkflowIDs)
	}
}

func TestAIProviderChangeImpactIncludesDelayedRun(t *testing.T) {
	exec, _ := newAIProviderUsageHarness(t)
	queue, err := execution.RegisterQueue(exec.ctx, "provider-impact-delayed", execution.WithWorkerConcurrency(0))
	if err != nil {
		t.Fatalf("RegisterQueue: %v", err)
	}

	const providerID = "provider-delayed"
	runIDs := make([]string, 0, 1)
	t.Cleanup(func() { cancelProviderUsageRuns(t, exec, runIDs) })
	runID := enqueueProviderUsageRun(
		t, exec, queue, providerUsageRunInput("delayed-provider-workflow", providerID), execution.WithDelay(time.Hour),
	)
	runIDs = append(runIDs, runID)
	awaitPersistedWorkflowStatus(t, exec, runID, execution.WorkflowStatusDelayed)

	impact := AIProviderChangeImpact(exec, providerID, func() string { return "revision-delayed" })
	if impact.MutationAllowed || !impactHasBlocker(impact, aiprovider.ChangeBlockerProviderInUse) {
		t.Fatalf("impact = %+v, want delayed run to block mutation", impact)
	}
	if len(impact.RunIDs) != 1 || impact.RunIDs[0] != runID {
		t.Fatalf("impact.RunIDs = %v, want delayed run %s", impact.RunIDs, runID)
	}
}

func TestAIProviderChangeImpactTreatsMalformedPersistedInputAsIndeterminate(t *testing.T) {
	exec, _ := newAIProviderUsageHarness(t)
	queue, err := execution.RegisterQueue(exec.ctx, "provider-impact-legacy", execution.WithWorkerConcurrency(0))
	if err != nil {
		t.Fatalf("RegisterQueue: %v", err)
	}

	runIDs := make([]string, 0, 1)
	t.Cleanup(func() { cancelProviderUsageRuns(t, exec, runIDs) })
	runID := enqueueProviderUsageRun(t, exec, queue, runInput{})
	runIDs = append(runIDs, runID)
	awaitPersistedWorkflowStatus(t, exec, runID, execution.WorkflowStatusEnqueued)

	impact := AIProviderChangeImpact(exec, "provider-legacy", func() string { return "revision-legacy" })
	if impact.MutationAllowed || !impactHasBlocker(impact, aiprovider.ChangeBlockerProviderUseIndeterminate) {
		t.Fatalf("impact = %+v, want malformed persisted input to be indeterminate", impact)
	}
}

func TestAIProviderChangeImpactRequiresEstablishedOwnership(t *testing.T) {
	exec, _ := newAIProviderUsageHarness(t)
	exec.aiProviderMutation.ownership = dataownership.ExecutionOwnershipUnestablished

	impact := AIProviderChangeImpact(exec, "provider-ownership", func() string { return "revision-ownership" })
	if impact.MutationAllowed || !impactHasBlocker(impact, aiprovider.ChangeBlockerProviderOwnershipUnestablished) {
		t.Fatalf("impact = %+v, want ownership refusal", impact)
	}

	exec.aiProviderMutation.ownership = dataownership.ExecutionOwnershipPrivateMemory
	impact = AIProviderChangeImpact(exec, "provider-ownership", func() string { return "revision-ownership" })
	if !impact.MutationAllowed || len(impact.BlockerCodes) != 0 {
		t.Fatalf("impact = %+v, want private-memory ownership to allow unused mutation", impact)
	}
}

func TestAIProviderChangeImpactRefusesWhenPersistedQueryFails(t *testing.T) {
	exec, shutdown := newAIProviderUsageHarness(t)
	shutdown()

	impact := AIProviderChangeImpact(exec, "provider-query-error", func() string { return "revision-query-error" })
	if impact.MutationAllowed || !impactHasBlocker(impact, aiprovider.ChangeBlockerProviderCheckUnavailable) {
		t.Fatalf("impact = %+v, want provider-check-unavailable after runtime shutdown", impact)
	}
}

func TestEnterAIProviderRunBodyRefusesCancelledRow(t *testing.T) {
	exec, _ := newAIProviderUsageHarness(t)
	queue, err := execution.RegisterQueue(exec.ctx, "provider-late-body", execution.WithWorkerConcurrency(0))
	if err != nil {
		t.Fatalf("RegisterQueue: %v", err)
	}
	in := providerUsageRunInput("cancelled-before-body", "provider-late")
	runID := enqueueProviderUsageRun(t, exec, queue, in)
	awaitPersistedWorkflowStatus(t, exec, runID, execution.WorkflowStatusEnqueued)
	if err := execution.CancelWorkflow(exec.ctx, runID); err != nil {
		t.Fatalf("CancelWorkflow: %v", err)
	}
	awaitPersistedWorkflowStatus(t, exec, runID, execution.WorkflowStatusCancelled)

	leave, err := enterAIProviderRunBody(exec, runID, in)
	if err == nil {
		leave()
		t.Fatal("enterAIProviderRunBody accepted a cancelled persisted row")
	}
	exec.aiProviderMutation.mu.Lock()
	_, live := exec.aiProviderMutation.live[runID]
	exec.aiProviderMutation.mu.Unlock()
	if live {
		t.Fatalf("cancelled run %s remained registered as a live provider body", runID)
	}
}
