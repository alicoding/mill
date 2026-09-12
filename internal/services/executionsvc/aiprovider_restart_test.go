package executionsvc

import (
	"path/filepath"
	"testing"
	"time"

	"github.com/alicoding/mill/internal/adapters/credential"
	"github.com/alicoding/mill/internal/adapters/dataownership"
	"github.com/alicoding/mill/internal/domain/aiprovider"
	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/alicoding/mill/internal/services/compositionsvc"
	"github.com/alicoding/mill/internal/services/configuresvc"
	"github.com/alicoding/mill/internal/services/guardrailsvc"
	"github.com/alicoding/mill/internal/services/servicetest"
)

func wireAIProviderMutationSafety(cfg *configuresvc.ConfigureService, exec *ExecutionService) {
	configuresvc.SetAIProviderMutationCoordinator(
		cfg,
		func(mutate func(assertUnused func(id string) error) error) error {
			return WithAIProviderMutations(exec, mutate)
		},
		func(id string, revision func() string) aiprovider.ChangeImpact {
			return AIProviderChangeImpact(exec, id, revision)
		},
	)
}

func startParkedProviderRun(t *testing.T, exec *ExecutionService, providerID string) string {
	t.Helper()
	workflow, err := exec.comp.CreateWorkflow("Recovered provider use", "", []composition.Node{
		{ID: "trigger", NodeTypeID: "trigger-manual"},
		{ID: "approval", NodeTypeID: "test-external-echo"},
		{ID: "ai", NodeTypeID: "process-ai-completion", Config: map[string]string{
			"aiproviderId": providerID, "prompt": "continue after restart",
		}},
	}, []composition.Edge{
		{ID: "to-approval", Source: "trigger", Target: "approval"},
		{ID: "to-ai", Source: "approval", Target: "ai"},
	})
	if err != nil {
		t.Fatalf("CreateWorkflow: %v", err)
	}
	summary, err := exec.RunWorkflow(workflow.ID, RunKindTest, nil)
	if err != nil {
		t.Fatalf("RunWorkflow: %v", err)
	}
	waitFor(t, "provider run to park", 10*time.Second, func() (bool, bool) {
		current, summaryErr := exec.summaryFor(summary.RunID)
		return current.Pending != nil, summaryErr == nil && current.Pending != nil
	})
	return summary.RunID
}

func relaunchProviderRuntime(
	t *testing.T,
	databasePath string,
	comp *compositionsvc.CompositionService,
	guard *guardrailsvc.GuardrailService,
) (*ExecutionService, func()) {
	t.Helper()
	exec, err := NewExecutionServiceWithOwnership(
		"sqlite:"+databasePath,
		dataownership.ExecutionOwnershipPrivateMemory,
		comp,
		guard,
	)
	if err != nil {
		t.Fatalf("NewExecutionServiceWithOwnership: %v", err)
	}
	active := true
	stop := func() {
		if !active {
			return
		}
		active = false
		if err := exec.Shutdown(2 * time.Second); err != nil {
			t.Errorf("Shutdown: %v", err)
		}
	}
	t.Cleanup(func() {
		if !active {
			return
		}
		cleanupProviderTestRuns(t, exec)
		stop()
	})
	return exec, stop
}

func waitForRecoveredProviderRun(t *testing.T, exec *ExecutionService, runID string) {
	t.Helper()
	waitFor(t, "provider run to recover and park", 30*time.Second, func() (bool, bool) {
		_, listening := exec.parkedRuns.Load(runID)
		return listening, listening
	})
}

func waitForProviderRunSuccess(t *testing.T, exec *ExecutionService, runID string) {
	t.Helper()
	final := waitFor(t, "recovered provider run to finish", 30*time.Second, func() (RunSummary, bool) {
		summary, err := exec.summaryFor(runID)
		return summary, err == nil && summary.Status == "SUCCESS"
	})
	if final.Status != "SUCCESS" {
		t.Fatalf("recovered run status = %q, want SUCCESS", final.Status)
	}
}

func TestAIProviderMutationRefusesRecoveredParkedUseUntilCompletion(t *testing.T) {
	store := servicetest.NewFakeStore()
	comp := compositionsvc.NewCompositionService(store)
	guard := guardrailsvc.NewGuardrailService(store, comp)
	cfg := configuresvc.NewConfigureService(store, comp, credential.NewInMemory())
	configuresvc.SetAIProviderMutationCoordinator(cfg,
		func(mutate func(assertUnused func(id string) error) error) error {
			return mutate(func(string) error { return nil })
		},
		func(id string, revision func() string) aiprovider.ChangeImpact {
			return aiprovider.ChangeImpact{ProviderID: id, ConfigRevision: revision(), MutationAllowed: true}
		},
	)
	endpoint := newProviderDestinationEndpoint(t, "recovered destination")
	provider, err := cfg.CreateAIProvider("Recovered provider", aiprovider.KindOpenAICompat, endpoint.server.URL, "old-model", "")
	if err != nil {
		t.Fatalf("CreateAIProvider: %v", err)
	}

	databasePath := filepath.Join(t.TempDir(), "provider-restart.db")
	execA, stopA := relaunchProviderRuntime(t, databasePath, comp, guard)
	wireAIProviderMutationSafety(cfg, execA)
	runID := startParkedProviderRun(t, execA, provider.ID)
	stopA()

	execB, _ := relaunchProviderRuntime(t, databasePath, comp, guard)
	wireAIProviderMutationSafety(cfg, execB)
	waitForRecoveredProviderRun(t, execB, runID)
	_, err = cfg.UpdateAIProvider(provider.ID, provider.Label, provider.Kind, provider.BaseURL, "new-model", provider.KeyRef)
	assertProviderInUseError(t, err)

	if err := execB.ResolveApproval(runID, "approval", true, nil, false); err != nil {
		t.Fatalf("ResolveApproval: %v", err)
	}
	waitForProviderRunSuccess(t, execB, runID)
	awaitNoLiveProviderBodies(t, execB)
	if endpoint.hits.Load() != 1 {
		t.Fatalf("recovered endpoint hits = %d, want 1", endpoint.hits.Load())
	}
	if _, err := cfg.UpdateAIProvider(provider.ID, provider.Label, provider.Kind, provider.BaseURL, "new-model", provider.KeyRef); err != nil {
		t.Fatalf("UpdateAIProvider after recovered run finished: %v", err)
	}
}

func TestAIProviderStartupSeedReconciliationPreservesRecoveredUse(t *testing.T) {
	store := servicetest.NewFakeStore()
	comp := compositionsvc.NewCompositionService(store)
	guard := guardrailsvc.NewGuardrailService(store, comp)
	cfg := configuresvc.NewConfigureService(store, comp, credential.NewInMemory())
	configuresvc.SetAIProviderMutationCoordinator(cfg,
		func(mutate func(assertUnused func(id string) error) error) error {
			return mutate(func(string) error { return nil })
		},
		func(id string, revision func() string) aiprovider.ChangeImpact {
			return aiprovider.ChangeImpact{ProviderID: id, ConfigRevision: revision(), MutationAllowed: true}
		},
	)
	if err := configuresvc.ReconcileBuiltInAIProviders(cfg); err != nil {
		t.Fatalf("initial ReconcileBuiltInAIProviders: %v", err)
	}
	providerID := aiprovider.ExampleLocalOllamaID

	databasePath := filepath.Join(t.TempDir(), "provider-seed-restart.db")
	execA, stopA := relaunchProviderRuntime(t, databasePath, comp, guard)
	wireAIProviderMutationSafety(cfg, execA)
	runID := startParkedProviderRun(t, execA, providerID)
	stopA()
	if err := store.Set("configure-aiproviders", "[]"); err != nil {
		t.Fatalf("clear persisted AI providers: %v", err)
	}

	compB := compositionsvc.NewCompositionService(store)
	guardB := guardrailsvc.NewGuardrailService(store, compB)
	cfgB := configuresvc.NewConfigureService(store, compB, credential.NewInMemory())
	if len(cfgB.AIProviders()) != 0 {
		t.Fatalf("fresh Configure constructor reconciled AI providers before safety wiring: %+v", cfgB.AIProviders())
	}
	execB, stopB := relaunchProviderRuntime(t, databasePath, compB, guardB)
	wireAIProviderMutationSafety(cfgB, execB)
	waitForRecoveredProviderRun(t, execB, runID)
	err := configuresvc.ReconcileBuiltInAIProviders(cfgB)
	assertProviderInUseError(t, err)
	if len(cfgB.AIProviders()) != 0 {
		t.Fatalf("refused seed reconciliation recreated providers during recovered use: %+v", cfgB.AIProviders())
	}

	if err := execB.CancelRun(runID); err != nil {
		t.Fatalf("CancelRun: %v", err)
	}
	awaitPersistedTerminal(t, execB, runID)
	// DBOS cancellation marks the row immediately but does not interrupt an
	// already-executing operation. Runtime shutdown is the restart boundary
	// that cancels the recovered approval wait and lets its body exit.
	stopB()
	awaitNoLiveProviderBodies(t, execB)
	execC, _ := relaunchProviderRuntime(t, databasePath, compB, guardB)
	wireAIProviderMutationSafety(cfgB, execC)
	if err := configuresvc.ReconcileBuiltInAIProviders(cfgB); err != nil {
		t.Fatalf("ReconcileBuiltInAIProviders after recovered run finished: %v", err)
	}
	for _, current := range cfgB.AIProviders() {
		if current.ID == providerID {
			return
		}
	}
	t.Fatalf("reconciled built-in provider %q is missing", providerID)
}
