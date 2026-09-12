package executionsvc

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/alicoding/mill/internal/adapters/aiclient"
	"github.com/alicoding/mill/internal/adapters/credential"
	"github.com/alicoding/mill/internal/adapters/dataownership"
	"github.com/alicoding/mill/internal/domain/aiprovider"
	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/alicoding/mill/internal/services/compositionsvc"
	"github.com/alicoding/mill/internal/services/configuresvc"
	"github.com/alicoding/mill/internal/services/guardrailsvc"
	"github.com/alicoding/mill/internal/services/servicetest"
)

type gatedProviderSettingsStore struct {
	inner   *servicetest.FakeStore
	mu      sync.Mutex
	armed   bool
	entered chan struct{}
	release chan struct{}
}

func newGatedProviderSettingsStore() *gatedProviderSettingsStore {
	return &gatedProviderSettingsStore{inner: servicetest.NewFakeStore()}
}

func (s *gatedProviderSettingsStore) Get(key string) any { return s.inner.Get(key) }

func (s *gatedProviderSettingsStore) Set(key string, value any) error {
	s.mu.Lock()
	armed, entered, release := s.armed, s.entered, s.release
	if armed {
		s.armed = false
	}
	s.mu.Unlock()
	if armed {
		close(entered)
		<-release
	}
	return s.inner.Set(key, value)
}

func (s *gatedProviderSettingsStore) arm(t *testing.T) (<-chan struct{}, func()) {
	t.Helper()
	s.mu.Lock()
	s.armed = true
	s.entered = make(chan struct{})
	s.release = make(chan struct{})
	entered, release := s.entered, s.release
	s.mu.Unlock()
	var once sync.Once
	unblock := func() { once.Do(func() { close(release) }) }
	t.Cleanup(unblock)
	return entered, unblock
}

type providerDestinationEndpoint struct {
	server *httptest.Server
	hits   atomic.Int32
	model  atomic.Value
}

func newProviderDestinationEndpoint(t *testing.T, text string) *providerDestinationEndpoint {
	t.Helper()
	endpoint := &providerDestinationEndpoint{}
	endpoint.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request struct {
			Model string `json:"model"`
		}
		if err := json.NewDecoder(r.Body).Decode(&request); err == nil {
			endpoint.model.Store(request.Model)
		}
		endpoint.hits.Add(1)
		w.Header().Set("Content-Type", "application/json")
		_, _ = fmt.Fprintf(w, `{"choices":[{"message":{"content":%q}}]}`, text)
	}))
	t.Cleanup(endpoint.server.Close)
	return endpoint
}

func (e *providerDestinationEndpoint) lastModel() string {
	if model := e.model.Load(); model != nil {
		return model.(string)
	}
	return ""
}

func newAIProviderDestinationHarness(
	t *testing.T,
	oldEndpoint string,
) (*gatedProviderSettingsStore, *configuresvc.ConfigureService, *ExecutionService, aiprovider.AIProvider) {
	t.Helper()
	store := newGatedProviderSettingsStore()
	comp := compositionsvc.NewCompositionService(store)
	cfg := configuresvc.NewConfigureService(store, comp, credential.NewInMemory())
	exec, err := NewExecutionServiceWithOwnership(
		"sqlite:"+filepath.Join(t.TempDir(), "provider-destination.db"),
		dataownership.ExecutionOwnershipPrivateMemory,
		comp,
		guardrailsvc.NewGuardrailService(store, comp),
	)
	if err != nil {
		t.Fatalf("NewExecutionServiceWithOwnership: %v", err)
	}
	t.Cleanup(func() { _ = exec.Shutdown(2 * time.Second) })
	t.Cleanup(func() { cleanupProviderTestRuns(t, exec) })

	configuresvc.SetAIProviderMutationCoordinator(cfg,
		func(mutate func(assertUnused func(id string) error) error) error {
			return mutate(func(string) error { return nil })
		},
		func(id string, revision func() string) aiprovider.ChangeImpact {
			return aiprovider.ChangeImpact{ProviderID: id, ConfigRevision: revision(), MutationAllowed: true}
		},
	)
	provider, err := cfg.CreateAIProvider("Provider race destination", aiprovider.KindOpenAICompat, oldEndpoint, "old-model", "")
	if err != nil {
		t.Fatalf("CreateAIProvider: %v", err)
	}
	configuresvc.SetAIProviderMutationCoordinator(cfg,
		func(mutate func(assertUnused func(id string) error) error) error {
			return WithAIProviderMutations(exec, mutate)
		},
		func(id string, revision func() string) aiprovider.ChangeImpact {
			return AIProviderChangeImpact(exec, id, revision)
		},
	)
	t.Cleanup(func() {
		cleanupProviderTestRuns(t, exec)
		composition.SetAICompleteFn(aiclient.Complete)
		composition.SetAIProviderLookup(func(id string, _ composition.SecretAccessRun) (composition.ResolvedAIProvider, error) {
			return composition.ResolvedAIProvider{}, fmt.Errorf("no AI provider lookup registered (yet) for id %q", id)
		})
	})
	return store, cfg, exec, provider
}

func TestAIProviderDestinationMutationFirstRunUsesUpdatedEndpoint(t *testing.T) {
	oldEndpoint := newProviderDestinationEndpoint(t, "old destination")
	newEndpoint := newProviderDestinationEndpoint(t, "new destination")
	store, cfg, exec, provider := newAIProviderDestinationHarness(t, oldEndpoint.server.URL)
	wfID := createBlockingAIWorkflow(t, exec.comp, "Destination mutation first", "trigger-manual", provider.ID)

	persistEntered, releasePersist := store.arm(t)
	updateResult := make(chan error, 1)
	go func() {
		_, err := cfg.UpdateAIProvider(provider.ID, provider.Label, provider.Kind, newEndpoint.server.URL, "new-model", provider.KeyRef)
		updateResult <- err
	}()
	awaitProviderRaceSignal(t, persistEntered, "provider update persistence")

	runResult := make(chan providerRunResult, 1)
	runDone := make(chan struct{})
	go func() {
		defer close(runDone)
		summary, err := exec.RunWorkflow(wfID, RunKindTest, nil)
		runResult <- providerRunResult{summary: summary, err: err}
	}()
	t.Cleanup(func() {
		releasePersist()
		select {
		case <-runDone:
		case <-time.After(10 * time.Second):
			t.Error("destination mutation-first run did not exit during cleanup")
		}
	})
	time.Sleep(150 * time.Millisecond)
	if oldEndpoint.hits.Load() != 0 || newEndpoint.hits.Load() != 0 {
		t.Fatalf("run reached an endpoint before the coordinated update persisted: old=%d new=%d", oldEndpoint.hits.Load(), newEndpoint.hits.Load())
	}
	releasePersist()
	if err := awaitProviderRaceError(t, updateResult, "provider update"); err != nil {
		t.Fatalf("UpdateAIProvider: %v", err)
	}
	got := awaitRunResult(t, runResult)
	if got.err != nil || got.summary.Status != "SUCCESS" || got.summary.Output != "new destination" {
		t.Fatalf("run = status %q output %q err %v, want updated destination", got.summary.Status, got.summary.Output, got.err)
	}
	if oldEndpoint.hits.Load() != 0 || newEndpoint.hits.Load() != 1 {
		t.Fatalf("endpoint hits = old %d new %d, want old 0 new 1", oldEndpoint.hits.Load(), newEndpoint.hits.Load())
	}
	if newEndpoint.lastModel() != "new-model" {
		t.Fatalf("new endpoint model = %q, want new-model", newEndpoint.lastModel())
	}
	awaitPersistedTerminal(t, exec, got.summary.RunID)
}

func TestAIProviderDestinationStartFirstRefusesUpdateAndFinishesOnOldEndpoint(t *testing.T) {
	oldEndpoint := newProviderDestinationEndpoint(t, "old destination")
	newEndpoint := newProviderDestinationEndpoint(t, "new destination")
	_, cfg, exec, provider := newAIProviderDestinationHarness(t, oldEndpoint.server.URL)
	wfID := createBlockingAIWorkflow(t, exec.comp, "Destination start first", "trigger-manual", provider.ID)

	transportReturned := make(chan struct{}, 1)
	releaseBody := make(chan struct{})
	var releaseOnce sync.Once
	release := func() { releaseOnce.Do(func() { close(releaseBody) }) }
	t.Cleanup(release)
	composition.SetAICompleteFn(func(req aiclient.Request) (aiclient.Result, error) {
		result, err := aiclient.Complete(req)
		select {
		case transportReturned <- struct{}{}:
		default:
		}
		<-releaseBody
		return result, err
	})

	runResult := make(chan providerRunResult, 1)
	runDone := make(chan struct{})
	go func() {
		defer close(runDone)
		summary, err := exec.RunWorkflow(wfID, RunKindTest, nil)
		runResult <- providerRunResult{summary: summary, err: err}
	}()
	t.Cleanup(func() {
		release()
		select {
		case <-runDone:
		case <-time.After(10 * time.Second):
			t.Error("destination start-first run did not exit during cleanup")
		}
	})
	awaitProviderRaceSignal(t, transportReturned, "old endpoint transport")
	_, err := cfg.UpdateAIProvider(provider.ID, provider.Label, provider.Kind, newEndpoint.server.URL, "new-model", provider.KeyRef)
	assertProviderInUseError(t, err)
	release()

	got := awaitRunResult(t, runResult)
	if got.err != nil || got.summary.Status != "SUCCESS" || got.summary.Output != "old destination" {
		t.Fatalf("run = status %q output %q err %v, want old destination", got.summary.Status, got.summary.Output, got.err)
	}
	if oldEndpoint.hits.Load() != 1 || newEndpoint.hits.Load() != 0 {
		t.Fatalf("endpoint hits = old %d new %d, want old 1 new 0", oldEndpoint.hits.Load(), newEndpoint.hits.Load())
	}
	if oldEndpoint.lastModel() != "old-model" {
		t.Fatalf("old endpoint model = %q, want old-model", oldEndpoint.lastModel())
	}
	var current aiprovider.AIProvider
	for _, candidate := range cfg.AIProviders() {
		if candidate.ID == provider.ID {
			current = candidate
			break
		}
	}
	if current.BaseURL != oldEndpoint.server.URL || current.Model != "old-model" {
		t.Fatalf("refused update changed provider to %+v", current)
	}
	awaitPersistedTerminal(t, exec, got.summary.RunID)
	awaitNoLiveProviderBodies(t, exec)
}
