package executionsvc

import (
	"testing"
	"time"

	"github.com/alicoding/mill/internal/adapters/execution"
	"github.com/alicoding/mill/internal/domain/aiprovider"
	"github.com/alicoding/mill/internal/domain/composition"
)

func TestAIProviderSampleObserverStopLatchesBeforeGenesisFinishes(t *testing.T) {
	state := newAIProviderSampleObserverState()
	attempt := aiprovider.SampleAttempt{RunID: "racing-genesis"}
	reserveSampleObservationForTest(t, state, attempt)

	stopped := make(chan struct{})
	go func() {
		stopAIProviderSampleObservers(state)
		close(stopped)
	}()

	deadline := time.Now().Add(time.Second)
	for {
		state.mu.Lock()
		latched := state.stopping
		state.mu.Unlock()
		if latched {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("stop did not latch")
		}
	}
	select {
	case <-stopped:
		t.Fatal("stop returned before the reserved genesis settled")
	default:
	}

	discardAIProviderSampleObservation(state, attempt.RunID)
	select {
	case <-stopped:
	case <-time.After(time.Second):
		t.Fatal("stop did not join the reserved genesis")
	}
	if _, ok := reserveFreshAIProviderSampleAttempt(state, func(composition.Workflow, string, map[string]string, string) (aiprovider.SampleAttempt, bool) {
		return aiprovider.SampleAttempt{RunID: "after-stop"}, true
	}, composition.Workflow{}, RunKindTest, RunOptions{}, "after-stop"); ok {
		t.Fatal("reservation succeeded after stop returned")
	}
}

func TestAIProviderSampleOutcomeRequiresTerminalPersistedStatus(t *testing.T) {
	tests := []struct {
		name      string
		operation aiprovider.Operation
		status    execution.WorkflowStatus
		want      aiprovider.SampleOutcome
		ok        bool
	}{
		{name: "text success", operation: aiprovider.OperationText, status: execution.WorkflowStatus{Status: execution.WorkflowStatusSuccess, Output: `"summary"`}, want: aiprovider.SampleOutcomeSucceeded, ok: true},
		{name: "empty text", operation: aiprovider.OperationText, status: execution.WorkflowStatus{Status: execution.WorkflowStatusSuccess, Output: `"  "`}, want: aiprovider.SampleOutcomeFailed, ok: true},
		{name: "structured success", operation: aiprovider.OperationStructured, status: execution.WorkflowStatus{Status: execution.WorkflowStatusSuccess}, want: aiprovider.SampleOutcomeSucceeded, ok: true},
		{name: "error", status: execution.WorkflowStatus{Status: execution.WorkflowStatusError}, want: aiprovider.SampleOutcomeFailed, ok: true},
		{name: "exhausted", status: execution.WorkflowStatus{Status: execution.WorkflowStatusMaxRecoveryAttemptsExceeded}, want: aiprovider.SampleOutcomeFailed, ok: true},
		{name: "cancelled", status: execution.WorkflowStatus{Status: execution.WorkflowStatusCancelled}, want: aiprovider.SampleOutcomeCancelled, ok: true},
		{name: "pending", status: execution.WorkflowStatus{Status: execution.WorkflowStatusPending}, ok: false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, ok := aiProviderSampleOutcomeFromStatus(tt.operation, tt.status)
			if ok != tt.ok || got != tt.want {
				t.Fatalf("aiProviderSampleOutcomeFromStatus = (%q, %t), want (%q, %t)", got, ok, tt.want, tt.ok)
			}
		})
	}
}

func TestDiscardAIProviderSampleObservationIsIdempotent(t *testing.T) {
	state := newAIProviderSampleObserverState()
	reserveSampleObservationForTest(t, state, aiprovider.SampleAttempt{RunID: "run-1"})
	discardAIProviderSampleObservation(state, "run-1")
	discardAIProviderSampleObservation(state, "run-1")
	stopAIProviderSampleObservers(state)
}

func TestAIProviderSampleObservationRequiresSuccessfulActivation(t *testing.T) {
	state := newAIProviderSampleObserverState()
	attempt := aiprovider.SampleAttempt{RunID: "run-1"}
	reserveSampleObservationForTest(t, state, attempt)
	if activateAIProviderSampleObservation(state, attempt.RunID, func(aiprovider.SampleAttempt) bool { return false }) {
		t.Fatal("activation returned true after Configure refused it")
	}
	state.mu.Lock()
	_, exists := state.observations[attempt.RunID]
	state.mu.Unlock()
	if exists {
		t.Fatal("failed activation left an observation reservation")
	}
	stopAIProviderSampleObservers(state)
}

func reserveSampleObservationForTest(t *testing.T, state *aiProviderSampleObserverState, attempt aiprovider.SampleAttempt) {
	t.Helper()
	capture := func(composition.Workflow, string, map[string]string, string) (aiprovider.SampleAttempt, bool) {
		return attempt, true
	}
	if _, ok := reserveFreshAIProviderSampleAttempt(state, capture, composition.Workflow{}, RunKindTest, RunOptions{}, attempt.RunID); !ok {
		t.Fatal("reserveFreshAIProviderSampleAttempt returned false")
	}
}
