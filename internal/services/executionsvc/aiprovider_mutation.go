package executionsvc

import (
	"fmt"
	"sync"

	"github.com/alicoding/mill/internal/adapters/dataownership"
	"github.com/alicoding/mill/internal/adapters/execution"
	"github.com/alicoding/mill/internal/domain/aiprovider"
	"github.com/alicoding/mill/internal/domain/usererror"
)

const (
	providerInUseMessage            = "Finish or stop the runs using this connection before changing it."
	providerUseIndeterminateMessage = "Mill cannot confirm that this connection is unused. Review unfinished runs before changing it."
	providerOwnershipMessage        = "Connection changes require exclusive access to the execution database."
)

type aiProviderMutationState struct {
	mu        sync.Mutex
	live      map[string]liveProviderRun
	ownership dataownership.ExecutionOwnership
}

type liveProviderRun struct {
	input  runInput
	bodies int
}

func newAIProviderMutationState(ownership dataownership.ExecutionOwnership) aiProviderMutationState {
	return aiProviderMutationState{live: make(map[string]liveProviderRun), ownership: ownership}
}

// WithAIProviderMutation serializes a provider mutation with every run genesis.
// The mutation callback decides whether its proposed change requires the
// assertion, allowing label-only edits to remain available.
func WithAIProviderMutation(e *ExecutionService, id string, mutate func(assertUnused func() error) error) error {
	if mutate == nil {
		return WithAIProviderMutations(e, nil)
	}
	return WithAIProviderMutations(e, func(assertUnused func(id string) error) error {
		return mutate(func() error { return assertUnused(id) })
	})
}

// WithAIProviderMutations holds one genesis lock while a trusted Configure
// callback discovers and applies a batch. Assertions are memoized per ID so a
// rollback/reconcile plan can safely ask more than once without repeating the
// authoritative query.
func WithAIProviderMutations(e *ExecutionService, mutate func(assertUnused func(id string) error) error) error {
	if e == nil || mutate == nil {
		return usererror.New(string(aiprovider.ChangeBlockerProviderCheckUnavailable), providerUseIndeterminateMessage)
	}
	e.runStartMu.Lock()
	defer e.runStartMu.Unlock()

	assertions := make(map[string]error)
	asserted := make(map[string]struct{})
	assertUnused := func(id string) error {
		if id == "" {
			return fmt.Errorf("AI provider safety assertion requires a nonempty ID")
		}
		if _, ok := asserted[id]; !ok {
			impact, queryErr := e.aiProviderChangeImpactLocked(id, "")
			assertions[id] = providerMutationRefusal(impact, queryErr)
			asserted[id] = struct{}{}
		}
		return assertions[id]
	}
	return mutate(assertUnused)
}

// AIProviderChangeImpact reads execution evidence under the same lock used by
// mutations and run genesis. Configure supplies a revision reader so the
// revision is captured after entering that lock, in the same snapshot order as
// a mutation callback.
func AIProviderChangeImpact(e *ExecutionService, id string, configRevision func() string) aiprovider.ChangeImpact {
	if e == nil {
		return aiprovider.ChangeImpact{
			ProviderID:   id,
			BlockerCodes: []aiprovider.ChangeBlockerCode{aiprovider.ChangeBlockerProviderCheckUnavailable},
		}
	}
	e.runStartMu.Lock()
	defer e.runStartMu.Unlock()
	revision := ""
	if configRevision != nil {
		revision = configRevision()
	}
	impact, _ := e.aiProviderChangeImpactLocked(id, revision)
	return impact
}

func (e *ExecutionService) aiProviderChangeImpactLocked(id, revision string) (aiprovider.ChangeImpact, error) {
	usage := e.scanAIProviderUsage(id)
	impact := aiprovider.ChangeImpact{
		ProviderID: id, ConfigRevision: revision,
		RunIDs: usage.runIDs(), WorkflowIDs: usage.workflowIDs(),
	}
	if usage.confirmed() {
		impact.BlockerCodes = append(impact.BlockerCodes, aiprovider.ChangeBlockerProviderInUse)
	}
	if usage.indeterminate {
		impact.BlockerCodes = append(impact.BlockerCodes, aiprovider.ChangeBlockerProviderUseIndeterminate)
	}
	if e.aiProviderMutation.ownership != dataownership.ExecutionOwnershipExclusiveLocal &&
		e.aiProviderMutation.ownership != dataownership.ExecutionOwnershipPrivateMemory {
		impact.BlockerCodes = append(impact.BlockerCodes, aiprovider.ChangeBlockerProviderOwnershipUnestablished)
	}
	if usage.queryErr != nil {
		impact.BlockerCodes = append(impact.BlockerCodes, aiprovider.ChangeBlockerProviderCheckUnavailable)
	}
	impact.MutationAllowed = len(impact.BlockerCodes) == 0
	return impact, usage.queryErr
}

func providerMutationRefusal(impact aiprovider.ChangeImpact, queryErr error) error {
	for _, blocker := range impact.BlockerCodes {
		if blocker == aiprovider.ChangeBlockerProviderInUse {
			return usererror.New(string(blocker), providerInUseMessage)
		}
	}
	for _, blocker := range impact.BlockerCodes {
		if blocker == aiprovider.ChangeBlockerProviderUseIndeterminate {
			return usererror.New(string(blocker), providerUseIndeterminateMessage)
		}
	}
	for _, blocker := range impact.BlockerCodes {
		if blocker == aiprovider.ChangeBlockerProviderOwnershipUnestablished {
			return usererror.New(string(blocker), providerOwnershipMessage)
		}
	}
	for _, blocker := range impact.BlockerCodes {
		if blocker == aiprovider.ChangeBlockerProviderCheckUnavailable {
			if queryErr == nil {
				queryErr = fmt.Errorf("provider usage query unavailable")
			}
			return usererror.Wrap(string(blocker), providerUseIndeterminateMessage, queryErr)
		}
	}
	return nil
}

// enterAIProviderRunBody closes the cancellation race between DBOS genesis and
// execution. A body that starts after its row became terminal never resolves a
// provider; an already-live body remains registered until its actual exit.
func enterAIProviderRunBody(e *ExecutionService, runID string, in runInput) (func(), error) {
	e.runStartMu.Lock()
	defer e.runStartMu.Unlock()

	statuses, err := execution.ListWorkflows(e.ctx,
		execution.WithFilterWorkflowIDs(runID),
		execution.WithFilterLoadInput(false),
		execution.WithFilterLoadOutput(false),
	)
	if err != nil {
		return nil, fmt.Errorf("confirm run %s is still executable: %w", runID, err)
	}
	if len(statuses) != 1 || statuses[0].Status != execution.WorkflowStatusPending {
		return nil, fmt.Errorf("run %s became terminal before its body started", runID)
	}

	e.aiProviderMutation.mu.Lock()
	live := e.aiProviderMutation.live[runID]
	live.input = in
	live.bodies++
	e.aiProviderMutation.live[runID] = live
	e.aiProviderMutation.mu.Unlock()

	return func() {
		e.aiProviderMutation.mu.Lock()
		live := e.aiProviderMutation.live[runID]
		if live.bodies <= 1 {
			delete(e.aiProviderMutation.live, runID)
		} else {
			live.bodies--
			e.aiProviderMutation.live[runID] = live
		}
		e.aiProviderMutation.mu.Unlock()
	}, nil
}
