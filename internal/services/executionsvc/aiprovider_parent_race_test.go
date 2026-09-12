package executionsvc

import (
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/alicoding/mill/internal/adapters/aiclient"
	"github.com/alicoding/mill/internal/domain/aiprovider"
	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/alicoding/mill/internal/domain/usererror"
)

func newImmediateAIEndpoint(t *testing.T) *httptest.Server {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"ok"}}]}`))
	}))
	t.Cleanup(server.Close)
	return server
}

func resolvedFixtureProvider(server *httptest.Server) composition.ResolvedAIProvider {
	return composition.ResolvedAIProvider{
		Kind: "openai-compatible", BaseURL: server.URL, Model: "fixture-model",
	}
}

func assertProviderInUseError(t *testing.T, err error) {
	t.Helper()
	if err == nil {
		t.Fatal("mutation unexpectedly succeeded while provider was in use")
	}
	var userErr *usererror.Error
	if !errors.As(err, &userErr) || userErr.Code != string(aiprovider.ChangeBlockerProviderInUse) {
		t.Fatalf("mutation error = %v, want user error code %q", err, aiprovider.ChangeBlockerProviderInUse)
	}
}

func awaitRunResult(t *testing.T, result <-chan providerRunResult) providerRunResult {
	t.Helper()
	select {
	case got := <-result:
		return got
	case <-time.After(15 * time.Second):
		t.Fatal("timed out waiting for RunWorkflow")
		return providerRunResult{}
	}
}

func awaitProviderRaceSignal(t *testing.T, signal <-chan struct{}, what string) {
	t.Helper()
	select {
	case <-signal:
	case <-time.After(10 * time.Second):
		t.Fatalf("timed out waiting for %s", what)
	}
}

func awaitProviderRaceError(t *testing.T, result <-chan error, what string) error {
	t.Helper()
	select {
	case err := <-result:
		return err
	case <-time.After(10 * time.Second):
		t.Fatalf("timed out waiting for %s", what)
		return nil
	}
}

func TestAIProviderParentGenesisMutationFirstStartsAfterMutation(t *testing.T) {
	exec, _ := newAIProviderUsageHarness(t)
	server := newImmediateAIEndpoint(t)
	const providerID = "provider-parent-mutation-first"
	lookupSeen := make(chan struct{}, 1)
	restore := swapAIProviderLookup(t, func(id string, _ composition.SecretAccessRun) (composition.ResolvedAIProvider, error) {
		if id != providerID {
			return composition.ResolvedAIProvider{}, fmt.Errorf("unexpected provider %q", id)
		}
		select {
		case lookupSeen <- struct{}{}:
		default:
		}
		return resolvedFixtureProvider(server), nil
	})
	t.Cleanup(restore)
	wfID := createBlockingAIWorkflow(t, exec.comp, "Parent mutation first", "trigger-manual", providerID)

	mutationEntered := make(chan struct{})
	releaseMutation := make(chan struct{})
	mutationResult := make(chan error, 1)
	go func() {
		mutationResult <- WithAIProviderMutation(exec, providerID, func(assertUnused func() error) error {
			if err := assertUnused(); err != nil {
				return err
			}
			close(mutationEntered)
			<-releaseMutation
			return nil
		})
	}()
	t.Cleanup(func() {
		select {
		case <-releaseMutation:
		default:
			close(releaseMutation)
		}
	})
	awaitProviderRaceSignal(t, mutationEntered, "mutation callback")

	runResult := make(chan providerRunResult, 1)
	runDone := make(chan struct{})
	go func() {
		defer close(runDone)
		summary, err := exec.RunWorkflow(wfID, RunKindTest, nil)
		runResult <- providerRunResult{summary: summary, err: err}
	}()
	t.Cleanup(func() {
		select {
		case <-releaseMutation:
		default:
			close(releaseMutation)
		}
		select {
		case <-runDone:
		case <-time.After(10 * time.Second):
			t.Error("parent mutation-first run did not exit during cleanup")
		}
	})
	select {
	case <-lookupSeen:
		t.Fatal("provider preflight crossed a mutation that still held runStartMu")
	case <-time.After(150 * time.Millisecond):
	}
	close(releaseMutation)
	if err := awaitProviderRaceError(t, mutationResult, "mutation result"); err != nil {
		t.Fatalf("unused-provider mutation: %v", err)
	}
	select {
	case <-lookupSeen:
	case <-time.After(10 * time.Second):
		t.Fatal("provider lookup never ran after the mutation released")
	}
	got := awaitRunResult(t, runResult)
	if got.err != nil || got.summary.Status != "SUCCESS" {
		t.Fatalf("RunWorkflow = status %q, err %v; want SUCCESS", got.summary.Status, got.err)
	}
	awaitPersistedTerminal(t, exec, got.summary.RunID)
}

func TestAIProviderParentGenesisStartFirstRefusesMutation(t *testing.T) {
	exec, _ := newAIProviderUsageHarness(t)
	t.Cleanup(func() { cleanupProviderTestRuns(t, exec) })
	server := newImmediateAIEndpoint(t)
	const providerID = "provider-parent-start-first"
	preflightEntered := make(chan struct{})
	releasePreflight := make(chan struct{})
	var first sync.Once
	restore := swapAIProviderLookup(t, func(id string, _ composition.SecretAccessRun) (composition.ResolvedAIProvider, error) {
		if id != providerID {
			return composition.ResolvedAIProvider{}, fmt.Errorf("unexpected provider %q", id)
		}
		first.Do(func() {
			close(preflightEntered)
			<-releasePreflight
		})
		return resolvedFixtureProvider(server), nil
	})
	t.Cleanup(restore)
	t.Cleanup(func() {
		select {
		case <-releasePreflight:
		default:
			close(releasePreflight)
		}
	})
	transportReturned := make(chan struct{}, 1)
	releaseBody := make(chan struct{})
	var releaseBodyOnce sync.Once
	releaseRunningBody := func() { releaseBodyOnce.Do(func() { close(releaseBody) }) }
	composition.SetAICompleteFn(func(req aiclient.Request) (aiclient.Result, error) {
		result, err := aiclient.Complete(req)
		select {
		case transportReturned <- struct{}{}:
		default:
		}
		<-releaseBody
		return result, err
	})
	t.Cleanup(func() {
		select {
		case <-releasePreflight:
		default:
			close(releasePreflight)
		}
		releaseRunningBody()
		cleanupProviderTestRuns(t, exec)
		composition.SetAICompleteFn(aiclient.Complete)
	})
	wfID := createBlockingAIWorkflow(t, exec.comp, "Parent start first", "trigger-manual", providerID)

	runResult := make(chan providerRunResult, 1)
	runDone := make(chan struct{})
	go func() {
		defer close(runDone)
		summary, err := exec.RunWorkflow(wfID, RunKindTest, nil)
		runResult <- providerRunResult{summary: summary, err: err}
	}()
	t.Cleanup(func() {
		select {
		case <-releasePreflight:
		default:
			close(releasePreflight)
		}
		releaseRunningBody()
		select {
		case <-runDone:
		case <-time.After(10 * time.Second):
			t.Error("parent start-first run did not exit during cleanup")
		}
	})
	select {
	case <-preflightEntered:
	case <-time.After(10 * time.Second):
		t.Fatal("provider-dependent preflight never entered")
	}

	mutationEntered := make(chan struct{})
	mutationResult := make(chan error, 1)
	go func() {
		mutationResult <- WithAIProviderMutation(exec, providerID, func(assertUnused func() error) error {
			close(mutationEntered)
			return assertUnused()
		})
	}()
	select {
	case <-mutationEntered:
		t.Fatal("mutation entered while parent preflight still held runStartMu")
	case <-time.After(150 * time.Millisecond):
	}
	close(releasePreflight)
	assertProviderInUseError(t, awaitProviderRaceError(t, mutationResult, "refused mutation result"))
	awaitProviderRaceSignal(t, transportReturned, "parent AI transport")
	releaseRunningBody()
	got := awaitRunResult(t, runResult)
	if got.err != nil || got.summary.Status != "SUCCESS" {
		t.Fatalf("RunWorkflow = status %q, err %v; want SUCCESS", got.summary.Status, got.err)
	}
	awaitPersistedTerminal(t, exec, got.summary.RunID)
}
