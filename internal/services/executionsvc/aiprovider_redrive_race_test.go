package executionsvc

import (
	"sync"
	"testing"
	"time"

	"github.com/alicoding/mill/internal/adapters/aiclient"
	"github.com/alicoding/mill/internal/adapters/execution"
	"github.com/alicoding/mill/internal/domain/composition"
)

func createCompletedConfiguredProviderRun(t *testing.T, exec *ExecutionService, providerID string) RunSummary {
	t.Helper()
	workflowID := createBlockingAIWorkflow(t, exec.comp, "Provider redrive", "trigger-manual", providerID)
	summary, err := exec.RunWorkflow(workflowID, RunKindTest, nil)
	if err != nil || summary.Status != "SUCCESS" {
		t.Fatalf("original RunWorkflow = status %q, err %v; want SUCCESS", summary.Status, err)
	}
	awaitPersistedTerminal(t, exec, summary.RunID)
	return summary
}

func TestAIProviderRedriveGenesisMutationFirstWaitsBeforeFork(t *testing.T) {
	oldEndpoint := newProviderDestinationEndpoint(t, "old redrive destination")
	newEndpoint := newProviderDestinationEndpoint(t, "new redrive destination")
	store, cfg, exec, provider := newAIProviderDestinationHarness(t, oldEndpoint.server.URL)
	original := createCompletedConfiguredProviderRun(t, exec, provider.ID)
	rows, err := execution.ListWorkflows(exec.ctx,
		execution.WithFilterLoadInput(false), execution.WithFilterLoadOutput(false),
	)
	if err != nil {
		t.Fatalf("ListWorkflows before redrive: %v", err)
	}
	baseline := len(rows)

	persistEntered, releasePersist := store.arm(t)
	mutationResult := make(chan error, 1)
	go func() {
		_, updateErr := cfg.UpdateAIProvider(
			provider.ID, provider.Label, provider.Kind, newEndpoint.server.URL, "new-redrive-model", provider.KeyRef,
		)
		mutationResult <- updateErr
	}()
	awaitProviderRaceSignal(t, persistEntered, "redrive provider update persistence")

	redriveResult := make(chan providerRunResult, 1)
	redriveDone := make(chan struct{})
	go func() {
		defer close(redriveDone)
		summary, redriveErr := exec.RedriveRun(original.RunID, "ai")
		redriveResult <- providerRunResult{summary: summary, err: redriveErr}
	}()
	t.Cleanup(func() {
		releasePersist()
		select {
		case <-redriveDone:
		case <-time.After(10 * time.Second):
			t.Error("redrive did not exit during cleanup")
		}
	})
	deadline := time.Now().Add(200 * time.Millisecond)
	for time.Now().Before(deadline) {
		current, listErr := execution.ListWorkflows(exec.ctx,
			execution.WithFilterLoadInput(false), execution.WithFilterLoadOutput(false),
		)
		if listErr != nil {
			t.Fatalf("ListWorkflows during held mutation: %v", listErr)
		}
		if len(current) != baseline {
			t.Fatalf("redrive created a fork while provider update held runStartMu: before=%d now=%d", baseline, len(current))
		}
		time.Sleep(20 * time.Millisecond)
	}
	releasePersist()
	if err := awaitProviderRaceError(t, mutationResult, "redrive provider update"); err != nil {
		t.Fatalf("UpdateAIProvider: %v", err)
	}
	redriven := awaitRunResult(t, redriveResult)
	if redriven.err != nil || redriven.summary.Status != "SUCCESS" || redriven.summary.Output != "new redrive destination" {
		t.Fatalf("RedriveRun = status %q, output %q, err %v; want new destination", redriven.summary.Status, redriven.summary.Output, redriven.err)
	}
	if redriven.summary.RunID == original.RunID {
		t.Fatal("RedriveRun reused the original run ID")
	}
	if oldEndpoint.hits.Load() != 1 || newEndpoint.hits.Load() != 1 {
		t.Fatalf("redrive endpoint hits = old %d new %d, want old 1 new 1", oldEndpoint.hits.Load(), newEndpoint.hits.Load())
	}
	if newEndpoint.lastModel() != "new-redrive-model" {
		t.Fatalf("new redrive endpoint model = %q, want new-redrive-model", newEndpoint.lastModel())
	}
	awaitPersistedTerminal(t, exec, redriven.summary.RunID)
}

func TestAIProviderRedriveGenesisStartFirstRefusesMutationUntilForkBodyExits(t *testing.T) {
	oldEndpoint := newProviderDestinationEndpoint(t, "old redrive destination")
	newEndpoint := newProviderDestinationEndpoint(t, "new redrive destination")
	_, cfg, exec, provider := newAIProviderDestinationHarness(t, oldEndpoint.server.URL)
	original := createCompletedConfiguredProviderRun(t, exec, provider.ID)

	transportReturned := make(chan struct{}, 1)
	releaseBody := make(chan struct{})
	var releaseOnce sync.Once
	release := func() { releaseOnce.Do(func() { close(releaseBody) }) }
	composition.SetAICompleteFn(func(req aiclient.Request) (aiclient.Result, error) {
		result, err := aiclient.Complete(req)
		select {
		case transportReturned <- struct{}{}:
		default:
		}
		<-releaseBody
		return result, err
	})

	redriveResult := make(chan providerRunResult, 1)
	redriveDone := make(chan struct{})
	go func() {
		defer close(redriveDone)
		summary, err := exec.RedriveRun(original.RunID, "ai")
		redriveResult <- providerRunResult{summary: summary, err: err}
	}()
	t.Cleanup(func() {
		release()
		select {
		case <-redriveDone:
		case <-time.After(10 * time.Second):
			t.Error("redrive body did not exit during cleanup")
		}
	})
	awaitProviderRaceSignal(t, transportReturned, "redrive AI transport")
	forkRunID := awaitLiveRunForWorkflow(t, exec, original.WorkflowID)
	if forkRunID == original.RunID {
		t.Fatalf("live redrive body reused original run ID %s", original.RunID)
	}

	_, mutationErr := cfg.UpdateAIProvider(
		provider.ID, provider.Label, provider.Kind, newEndpoint.server.URL, "new-redrive-model", provider.KeyRef,
	)
	assertProviderInUseError(t, mutationErr)
	release()
	redriven := awaitRunResult(t, redriveResult)
	if redriven.err != nil || redriven.summary.Status != "SUCCESS" || redriven.summary.Output != "old redrive destination" {
		t.Fatalf("RedriveRun = status %q, output %q, err %v; want old destination", redriven.summary.Status, redriven.summary.Output, redriven.err)
	}
	if redriven.summary.RunID != forkRunID {
		t.Fatalf("RedriveRun ID = %s, want live fork %s", redriven.summary.RunID, forkRunID)
	}
	if oldEndpoint.hits.Load() != 2 || newEndpoint.hits.Load() != 0 {
		t.Fatalf("redrive endpoint hits = old %d new %d, want old 2 new 0", oldEndpoint.hits.Load(), newEndpoint.hits.Load())
	}
	if oldEndpoint.lastModel() != "old-model" {
		t.Fatalf("old redrive endpoint model = %q, want old-model", oldEndpoint.lastModel())
	}
	awaitPersistedTerminal(t, exec, forkRunID)
	awaitNoLiveProviderBodies(t, exec)
}
