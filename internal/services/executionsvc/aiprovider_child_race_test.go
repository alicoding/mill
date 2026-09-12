package executionsvc

import (
	"strconv"
	"sync"
	"testing"
	"time"

	"github.com/alicoding/mill/internal/adapters/aiclient"
	"github.com/alicoding/mill/internal/adapters/execution"
	"github.com/alicoding/mill/internal/domain/composition"
)

func TestAIProviderChildGenesisMutationFirstWaitsBeforeCreatingChildRow(t *testing.T) {
	oldEndpoint := newProviderDestinationEndpoint(t, "old child destination")
	newEndpoint := newProviderDestinationEndpoint(t, "new child destination")
	store, cfg, exec, provider := newAIProviderDestinationHarness(t, oldEndpoint.server.URL)

	childID := createBlockingAIWorkflow(t, exec.comp, "Child mutation first", "trigger-callable", provider.ID)
	published, err := exec.comp.PublishWorkflow(childID)
	if err != nil {
		t.Fatalf("PublishWorkflow(child): %v", err)
	}
	parent, err := exec.comp.CreateWorkflow("Parent waits for provider mutation", "", []composition.Node{
		{ID: "trigger", NodeTypeID: "trigger-manual"},
		{ID: "child", NodeTypeID: "child-workflow", Config: map[string]string{
			"workflowId": childID, "version": strconv.Itoa(published.PublishedVersion), "inputBindings": "{}",
		}},
	}, []composition.Edge{{ID: "to-child", Source: "trigger", Target: "child"}})
	if err != nil {
		t.Fatalf("CreateWorkflow(parent): %v", err)
	}

	persistEntered, releasePersist := store.arm(t)
	mutationResult := make(chan error, 1)
	go func() {
		_, updateErr := cfg.UpdateAIProvider(
			provider.ID, provider.Label, provider.Kind, newEndpoint.server.URL, "new-child-model", provider.KeyRef,
		)
		mutationResult <- updateErr
	}()
	awaitProviderRaceSignal(t, persistEntered, "child provider update persistence")

	runResult := make(chan providerRunResult, 1)
	runDone := make(chan struct{})
	go func() {
		defer close(runDone)
		summary, runErr := exec.RunWorkflow(parent.ID, RunKindTest, nil)
		runResult <- providerRunResult{summary: summary, err: runErr}
	}()
	t.Cleanup(func() {
		releasePersist()
		select {
		case <-runDone:
		case <-time.After(10 * time.Second):
			t.Error("parent and child workflow bodies did not exit during cleanup")
		}
	})

	deadline := time.Now().Add(200 * time.Millisecond)
	for time.Now().Before(deadline) {
		rows, listErr := execution.ListWorkflows(exec.ctx,
			execution.WithFilterLoadInput(true),
			execution.WithFilterLoadOutput(false),
		)
		if listErr != nil {
			t.Fatalf("ListWorkflows: %v", listErr)
		}
		for _, row := range rows {
			input, ok := decodeAny[runInput](row.Input)
			if ok && input.WorkflowID == childID {
				t.Fatalf("child row appeared while mutation held runStartMu: %+v", row)
			}
		}
		time.Sleep(20 * time.Millisecond)
	}
	releasePersist()
	if mutationErr := awaitProviderRaceError(t, mutationResult, "child-race mutation result"); mutationErr != nil {
		t.Fatalf("UpdateAIProvider: %v", mutationErr)
	}

	got := awaitRunResult(t, runResult)
	if got.err != nil || got.summary.Status != "SUCCESS" || got.summary.Output != "new child destination" {
		t.Fatalf("RunWorkflow(parent) = status %q, output %q, err %v; want new child destination", got.summary.Status, got.summary.Output, got.err)
	}
	if oldEndpoint.hits.Load() != 0 || newEndpoint.hits.Load() != 1 {
		t.Fatalf("child endpoint hits = old %d new %d, want old 0 new 1", oldEndpoint.hits.Load(), newEndpoint.hits.Load())
	}
	if newEndpoint.lastModel() != "new-child-model" {
		t.Fatalf("new child endpoint model = %q, want new-child-model", newEndpoint.lastModel())
	}
	children, err := execution.ListWorkflows(exec.ctx,
		execution.WithFilterParentWorkflowID(got.summary.RunID),
		execution.WithFilterLoadInput(false),
		execution.WithFilterLoadOutput(false),
	)
	if err != nil || len(children) != 1 {
		t.Fatalf("ListWorkflows(children) = %+v, %v; want one child", children, err)
	}
	awaitPersistedTerminal(t, exec, got.summary.RunID)
	awaitPersistedTerminal(t, exec, children[0].ID)
	awaitNoLiveProviderBodies(t, exec)
}

func TestAIProviderChildGenesisStartFirstRefusesUpdateAndFinishesOnOldEndpoint(t *testing.T) {
	oldEndpoint := newProviderDestinationEndpoint(t, "old child destination")
	newEndpoint := newProviderDestinationEndpoint(t, "new child destination")
	_, cfg, exec, provider := newAIProviderDestinationHarness(t, oldEndpoint.server.URL)

	childID := createBlockingAIWorkflow(t, exec.comp, "Child start first", "trigger-callable", provider.ID)
	published, err := exec.comp.PublishWorkflow(childID)
	if err != nil {
		t.Fatalf("PublishWorkflow(child): %v", err)
	}
	parent, err := exec.comp.CreateWorkflow("Parent starting provider child", "", []composition.Node{
		{ID: "trigger", NodeTypeID: "trigger-manual"},
		{ID: "child", NodeTypeID: "child-workflow", Config: map[string]string{
			"workflowId": childID, "version": strconv.Itoa(published.PublishedVersion), "inputBindings": "{}",
		}},
	}, []composition.Edge{{ID: "to-child", Source: "trigger", Target: "child"}})
	if err != nil {
		t.Fatalf("CreateWorkflow(parent): %v", err)
	}

	transportReturned := make(chan struct{}, 1)
	releaseBody := make(chan struct{})
	var releaseOnce sync.Once
	release := func() { releaseOnce.Do(func() { close(releaseBody) }) }
	composition.SetAICompleteFn(func(req aiclient.Request) (aiclient.Result, error) {
		result, completeErr := aiclient.Complete(req)
		select {
		case transportReturned <- struct{}{}:
		default:
		}
		<-releaseBody
		return result, completeErr
	})

	runResult := make(chan providerRunResult, 1)
	runDone := make(chan struct{})
	go func() {
		defer close(runDone)
		summary, runErr := exec.RunWorkflow(parent.ID, RunKindTest, nil)
		runResult <- providerRunResult{summary: summary, err: runErr}
	}()
	t.Cleanup(func() {
		release()
		select {
		case <-runDone:
		case <-time.After(10 * time.Second):
			t.Error("parent and child workflow bodies did not exit during cleanup")
		}
	})
	awaitProviderRaceSignal(t, transportReturned, "child AI transport")
	childRunID := awaitLiveRunForWorkflow(t, exec, childID)

	_, mutationErr := cfg.UpdateAIProvider(
		provider.ID, provider.Label, provider.Kind, newEndpoint.server.URL, "new-child-model", provider.KeyRef,
	)
	assertProviderInUseError(t, mutationErr)
	release()
	got := awaitRunResult(t, runResult)
	if got.err != nil || got.summary.Status != "SUCCESS" || got.summary.Output != "old child destination" {
		t.Fatalf("RunWorkflow(parent) = status %q, output %q, err %v; want old child destination", got.summary.Status, got.summary.Output, got.err)
	}
	if oldEndpoint.hits.Load() != 1 || newEndpoint.hits.Load() != 0 {
		t.Fatalf("child endpoint hits = old %d new %d, want old 1 new 0", oldEndpoint.hits.Load(), newEndpoint.hits.Load())
	}
	if oldEndpoint.lastModel() != "old-model" {
		t.Fatalf("old child endpoint model = %q, want old-model", oldEndpoint.lastModel())
	}
	awaitPersistedTerminal(t, exec, got.summary.RunID)
	awaitPersistedTerminal(t, exec, childRunID)
	awaitNoLiveProviderBodies(t, exec)
}
