package executionsvc

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strconv"
	"sync"
	"testing"
	"time"

	"github.com/alicoding/mill/internal/adapters/aiclient"
	"github.com/alicoding/mill/internal/adapters/execution"
	"github.com/alicoding/mill/internal/domain/aiprovider"
	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/alicoding/mill/internal/services/compositionsvc"
)

type providerRunResult struct {
	summary RunSummary
	err     error
}

type blockingAIEndpoint struct {
	server            *httptest.Server
	requestSeen       chan struct{}
	transportReturned chan struct{}
	release           chan struct{}
	releaseOnce       sync.Once
}

func newBlockingAIEndpoint(t *testing.T) *blockingAIEndpoint {
	t.Helper()
	endpoint := &blockingAIEndpoint{
		requestSeen:       make(chan struct{}, 1),
		transportReturned: make(chan struct{}, 1),
		release:           make(chan struct{}),
	}
	endpoint.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/chat/completions" {
			t.Errorf("AI request path = %q, want /v1/chat/completions", r.URL.Path)
		}
		select {
		case endpoint.requestSeen <- struct{}{}:
		default:
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"released"}}]}`))
	}))
	t.Cleanup(func() {
		endpoint.releaseRequest()
		endpoint.server.Close()
	})
	return endpoint
}

func (e *blockingAIEndpoint) releaseRequest() { e.releaseOnce.Do(func() { close(e.release) }) }

func wireBlockingAIProvider(t *testing.T, exec *ExecutionService, endpoint *blockingAIEndpoint, providerID string) {
	t.Helper()
	restore := swapAIProviderLookup(t, func(id string, _ composition.SecretAccessRun) (composition.ResolvedAIProvider, error) {
		if id != providerID {
			return composition.ResolvedAIProvider{}, fmt.Errorf("unexpected provider %q", id)
		}
		return composition.ResolvedAIProvider{
			Kind: "openai-compatible", BaseURL: endpoint.server.URL, Model: "fixture-model",
		}, nil
	})
	composition.SetAICompleteFn(func(req aiclient.Request) (aiclient.Result, error) {
		result, err := aiclient.Complete(req)
		select {
		case endpoint.transportReturned <- struct{}{}:
		default:
		}
		<-endpoint.release
		return result, err
	})
	t.Cleanup(func() {
		endpoint.releaseRequest()
		cleanupProviderTestRuns(t, exec)
		composition.SetAICompleteFn(aiclient.Complete)
		restore()
	})
}

func createBlockingAIWorkflow(t *testing.T, comp *compositionsvc.CompositionService, label, triggerID, providerID string) string {
	t.Helper()
	wf, err := comp.CreateWorkflow(label, "", []composition.Node{
		{ID: "trigger", NodeTypeID: triggerID},
		{ID: "ai", NodeTypeID: "process-ai-completion", Config: map[string]string{
			"aiproviderId": providerID, "prompt": "wait",
		}},
	}, []composition.Edge{{ID: "edge", Source: "trigger", Target: "ai"}})
	if err != nil {
		t.Fatalf("CreateWorkflow(%s): %v", label, err)
	}
	return wf.ID
}

func awaitLiveRunForWorkflow(t *testing.T, exec *ExecutionService, workflowID string) string {
	t.Helper()
	return waitFor(t, "live provider body for "+workflowID, 10*time.Second, func() (string, bool) {
		exec.aiProviderMutation.mu.Lock()
		defer exec.aiProviderMutation.mu.Unlock()
		for runID, live := range exec.aiProviderMutation.live {
			if live.input.WorkflowID == workflowID {
				return runID, true
			}
		}
		return "", false
	})
}

func awaitNoLiveProviderBodies(t *testing.T, exec *ExecutionService) {
	t.Helper()
	waitFor(t, "provider bodies to exit", 10*time.Second, func() (struct{}, bool) {
		exec.aiProviderMutation.mu.Lock()
		defer exec.aiProviderMutation.mu.Unlock()
		return struct{}{}, len(exec.aiProviderMutation.live) == 0
	})
}

func awaitPersistedTerminal(t *testing.T, exec *ExecutionService, runID string) {
	t.Helper()
	waitFor(t, "workflow "+runID+" to become terminal", 15*time.Second, func() (execution.WorkflowStatusType, bool) {
		rows, err := execution.ListWorkflows(exec.ctx,
			execution.WithFilterWorkflowIDs(runID),
			execution.WithFilterLoadInput(false),
			execution.WithFilterLoadOutput(false),
		)
		if err != nil || len(rows) != 1 {
			return "", false
		}
		switch string(rows[0].Status) {
		case "SUCCESS", "ERROR", "CANCELLED", "MAX_RECOVERY_ATTEMPTS_EXCEEDED":
			return rows[0].Status, true
		default:
			return "", false
		}
	})
}

func cleanupProviderTestRuns(t *testing.T, exec *ExecutionService) {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		rows, err := execution.ListWorkflows(exec.ctx,
			execution.WithFilterStatus(
				execution.WorkflowStatusPending,
				execution.WorkflowStatusEnqueued,
				execution.WorkflowStatusDelayed,
			),
			execution.WithFilterLoadInput(false),
			execution.WithFilterLoadOutput(false),
		)
		if err != nil {
			t.Errorf("ListWorkflows during cleanup: %v", err)
			return
		}
		for _, row := range rows {
			if err := execution.CancelWorkflow(exec.ctx, row.ID); err != nil {
				t.Errorf("CancelWorkflow(%s) during cleanup: %v", row.ID, err)
			}
		}
		exec.aiProviderMutation.mu.Lock()
		live := len(exec.aiProviderMutation.live)
		exec.aiProviderMutation.mu.Unlock()
		if len(rows) == 0 && live == 0 {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Error("provider test runs did not all become terminal and quiescent during cleanup")
}

func containsRunID(runIDs []string, want string) bool {
	for _, runID := range runIDs {
		if runID == want {
			return true
		}
	}
	return false
}

func TestAIProviderMutationWaitsForCancelledExecutingBodyToExit(t *testing.T) {
	exec, _ := newAIProviderUsageHarness(t)
	t.Cleanup(func() { cleanupProviderTestRuns(t, exec) })
	endpoint := newBlockingAIEndpoint(t)
	const providerID = "provider-live-cancel"
	wireBlockingAIProvider(t, exec, endpoint, providerID)
	wfID := createBlockingAIWorkflow(t, exec.comp, "Blocked AI request", "trigger-manual", providerID)

	result := make(chan providerRunResult, 1)
	done := make(chan struct{})
	go func() {
		defer close(done)
		summary, err := exec.RunWorkflow(wfID, RunKindTest, nil)
		result <- providerRunResult{summary: summary, err: err}
	}()
	t.Cleanup(func() {
		endpoint.releaseRequest()
		select {
		case <-done:
		case <-time.After(10 * time.Second):
			t.Error("workflow goroutine did not exit during cleanup")
		}
	})

	select {
	case <-endpoint.transportReturned:
	case <-time.After(10 * time.Second):
		t.Fatal("real AI transport never returned to the gated workflow body")
	}
	runID := awaitLiveRunForWorkflow(t, exec, wfID)
	if err := exec.CancelRun(runID); err != nil {
		t.Fatalf("CancelRun: %v", err)
	}
	awaitPersistedWorkflowStatus(t, exec, runID, execution.WorkflowStatusCancelled)

	impact := AIProviderChangeImpact(exec, providerID, func() string { return "revision-live" })
	if impact.MutationAllowed || !impactHasBlocker(impact, aiprovider.ChangeBlockerProviderInUse) || !containsRunID(impact.RunIDs, runID) {
		t.Fatalf("impact while cancelled body is live = %+v, want provider-in-use with run %s", impact, runID)
	}

	endpoint.releaseRequest()
	got := awaitRunResult(t, result)
	if got.err != nil {
		t.Fatalf("RunWorkflow returned transport error after cancellation: %v", got.err)
	}
	awaitPersistedTerminal(t, exec, runID)
	awaitNoLiveProviderBodies(t, exec)
	impact = AIProviderChangeImpact(exec, providerID, func() string { return "revision-live" })
	if !impact.MutationAllowed {
		t.Fatalf("impact after body exit = %+v, want mutation allowed", impact)
	}
}

func TestAIProviderImpactCountsLiveChildAfterParentCancellation(t *testing.T) {
	exec, _ := newAIProviderUsageHarness(t)
	t.Cleanup(func() { cleanupProviderTestRuns(t, exec) })
	endpoint := newBlockingAIEndpoint(t)
	const providerID = "provider-live-child"
	wireBlockingAIProvider(t, exec, endpoint, providerID)

	childID := createBlockingAIWorkflow(t, exec.comp, "Blocked AI child", "trigger-callable", providerID)
	published, err := exec.comp.PublishWorkflow(childID)
	if err != nil {
		t.Fatalf("PublishWorkflow(child): %v", err)
	}
	parent, err := exec.comp.CreateWorkflow("Parent of blocked AI child", "", []composition.Node{
		{ID: "trigger", NodeTypeID: "trigger-manual"},
		{ID: "child", NodeTypeID: "child-workflow", Config: map[string]string{
			"workflowId": childID, "version": strconv.Itoa(published.PublishedVersion), "inputBindings": "{}",
		}},
	}, []composition.Edge{{ID: "edge", Source: "trigger", Target: "child"}})
	if err != nil {
		t.Fatalf("CreateWorkflow(parent): %v", err)
	}

	result := make(chan providerRunResult, 1)
	done := make(chan struct{})
	go func() {
		defer close(done)
		summary, runErr := exec.RunWorkflow(parent.ID, RunKindTest, nil)
		result <- providerRunResult{summary: summary, err: runErr}
	}()
	t.Cleanup(func() {
		endpoint.releaseRequest()
		select {
		case <-done:
		case <-time.After(10 * time.Second):
			t.Error("parent workflow goroutine did not exit during cleanup")
		}
	})

	select {
	case <-endpoint.transportReturned:
	case <-time.After(10 * time.Second):
		t.Fatal("real AI transport never returned to the gated child body")
	}
	parentRunID := awaitLiveRunForWorkflow(t, exec, parent.ID)
	childRunID := awaitLiveRunForWorkflow(t, exec, childID)
	if err := exec.CancelRun(parentRunID); err != nil {
		t.Fatalf("CancelRun(parent): %v", err)
	}
	awaitPersistedWorkflowStatus(t, exec, parentRunID, execution.WorkflowStatusCancelled)

	impact := AIProviderChangeImpact(exec, providerID, func() string { return "revision-child" })
	if impact.MutationAllowed || !impactHasBlocker(impact, aiprovider.ChangeBlockerProviderInUse) || !containsRunID(impact.RunIDs, childRunID) {
		t.Fatalf("impact after parent cancellation = %+v, want live child %s to block", impact, childRunID)
	}
	mutationErr := WithAIProviderMutation(exec, providerID, func(assertUnused func() error) error {
		return assertUnused()
	})
	assertProviderInUseError(t, mutationErr)

	endpoint.releaseRequest()
	got := awaitRunResult(t, result)
	if got.err != nil {
		t.Fatalf("RunWorkflow(parent) returned transport error: %v", got.err)
	}
	awaitPersistedTerminal(t, exec, parentRunID)
	awaitPersistedTerminal(t, exec, childRunID)
	awaitNoLiveProviderBodies(t, exec)
}
