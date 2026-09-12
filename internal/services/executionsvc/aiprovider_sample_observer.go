package executionsvc

import (
	"strings"
	"sync"
	"time"

	"github.com/alicoding/mill/internal/adapters/execution"
	"github.com/alicoding/mill/internal/domain/aiprovider"
)

const aiProviderSampleStatusReadTimeout = 5 * time.Second

type aiProviderSampleObservation struct {
	attempt aiprovider.SampleAttempt
	cancel  func()
	active  bool
	started bool
}

// activateAIProviderSampleObservation runs only after successful DBOS genesis
// while runStartMu is still held. A failed activation discards the reservation
// and produces no observer.
func activateAIProviderSampleObservation(
	state *aiProviderSampleObserverState,
	runID string,
	activate func(aiprovider.SampleAttempt) bool,
) bool {
	if state == nil || activate == nil {
		discardAIProviderSampleObservation(state, runID)
		return false
	}
	state.mu.Lock()
	observation, exists := state.observations[runID]
	if !exists || observation.started || state.stopping {
		if exists && !observation.started {
			delete(state.observations, runID)
		}
		state.mu.Unlock()
		if exists && !observation.started {
			state.workers.Done()
		}
		return false
	}
	if !activate(observation.attempt) {
		delete(state.observations, runID)
		state.mu.Unlock()
		state.workers.Done()
		return false
	}
	observation.active = true
	state.mu.Unlock()
	return true
}

// aiProviderSampleObserverState owns only evidence observers. Cancelling this
// state never calls execution.CancelWorkflow and therefore never stops a
// user's durable run.
type aiProviderSampleObserverState struct {
	mu           sync.Mutex
	stopping     bool
	observations map[string]*aiProviderSampleObservation
	workers      sync.WaitGroup
}

func newAIProviderSampleObserverState() *aiProviderSampleObserverState {
	return &aiProviderSampleObserverState{observations: make(map[string]*aiProviderSampleObservation)}
}

// discardAIProviderSampleObservation releases a pre-genesis reservation after
// RunWorkflow fails. There is no persisted run to observe in that case.
func discardAIProviderSampleObservation(state *aiProviderSampleObserverState, runID string) {
	if state == nil {
		return
	}
	state.mu.Lock()
	observation, exists := state.observations[runID]
	discarded := exists && !observation.started
	if discarded {
		delete(state.observations, runID)
	}
	state.mu.Unlock()
	if discarded {
		state.workers.Done()
	}
}

// startAIProviderSampleObservation starts exactly one persisted-result wait
// after successful DBOS genesis and after the run genesis lock is released.
func startAIProviderSampleObservation(
	state *aiProviderSampleObserverState,
	ctx execution.Context,
	runID string,
	settle func(aiprovider.SampleAttempt, aiprovider.SampleOutcome, time.Time),
) bool {
	if state == nil || ctx == nil || settle == nil {
		discardAIProviderSampleObservation(state, runID)
		return false
	}

	observerContext, cancel := execution.WithCancel(ctx)
	state.mu.Lock()
	observation, exists := state.observations[runID]
	if !exists || !observation.active || observation.started || state.stopping {
		if exists && !observation.started {
			delete(state.observations, runID)
		}
		state.mu.Unlock()
		cancel()
		if exists && !observation.started {
			state.workers.Done()
		}
		return false
	}
	observation.started = true
	observation.cancel = cancel
	state.mu.Unlock()

	go observeAIProviderSampleResult(state, observerContext, observation, settle)
	return true
}

func observeAIProviderSampleResult(
	state *aiProviderSampleObserverState,
	ctx execution.Context,
	observation *aiProviderSampleObservation,
	settle func(aiprovider.SampleAttempt, aiprovider.SampleOutcome, time.Time),
) {
	defer func() {
		observation.cancel()
		state.mu.Lock()
		delete(state.observations, observation.attempt.RunID)
		state.mu.Unlock()
		state.workers.Done()
	}()

	handle, err := execution.RetrieveWorkflow[string](ctx, observation.attempt.RunID)
	if err != nil {
		return
	}
	_, _ = handle.GetResult()

	statusContext, cancelStatus := execution.WithTimeout(ctx, aiProviderSampleStatusReadTimeout)
	defer cancelStatus()
	status, err := execution.WorkflowByID(statusContext, observation.attempt.RunID, true)
	if err != nil {
		return
	}
	outcome, ok := aiProviderSampleOutcomeFromStatus(observation.attempt.Operation, status)
	if !ok {
		return
	}
	checkedAt := status.CompletedAt
	if checkedAt.IsZero() {
		checkedAt = status.UpdatedAt
	}
	settle(observation.attempt, outcome, checkedAt)
}

func aiProviderSampleOutcomeFromStatus(operation aiprovider.Operation, status execution.WorkflowStatus) (aiprovider.SampleOutcome, bool) {
	switch status.Status {
	case execution.WorkflowStatusSuccess:
		if operation == aiprovider.OperationText {
			output, ok := decodeAny[string](status.Output)
			if !ok || strings.TrimSpace(output) == "" {
				return aiprovider.SampleOutcomeFailed, true
			}
		}
		return aiprovider.SampleOutcomeSucceeded, true
	case execution.WorkflowStatusError, execution.WorkflowStatusMaxRecoveryAttemptsExceeded:
		return aiprovider.SampleOutcomeFailed, true
	case execution.WorkflowStatusCancelled:
		return aiprovider.SampleOutcomeCancelled, true
	default:
		return "", false
	}
}

// stopAIProviderSampleObservers latches the state before cancelling and
// joining workers. A racing reserved genesis must either start before this
// latch and be joined, or discard its reservation without creating an
// observer. No token or observer can be added after this function returns.
func stopAIProviderSampleObservers(state *aiProviderSampleObserverState) {
	if state == nil {
		return
	}
	state.mu.Lock()
	state.stopping = true
	cancels := make([]func(), 0, len(state.observations))
	for _, observation := range state.observations {
		if observation.cancel != nil {
			cancels = append(cancels, observation.cancel)
		}
	}
	state.mu.Unlock()
	for _, cancel := range cancels {
		cancel()
	}
	state.workers.Wait()
}
