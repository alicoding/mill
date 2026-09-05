package executionsvc

import (
	"context"
	"fmt"
	"log/slog"
	"sort"
	"time"

	"github.com/alicoding/mill/internal/adapters/execution"
	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/alicoding/mill/internal/domain/guardrail"
	"github.com/alicoding/mill/internal/domain/secret"
	"github.com/alicoding/mill/internal/services/dataevent"
	"github.com/alicoding/mill/internal/services/guardrailsvc"
)

// A run that needs a secret while the vault is locked waits for the
// vault (goal 0360 S2): the step's own error is the signal
// (secret.IsVaultLocked), the executor parks the run on the SAME
// durable park an approval uses (executionservice_park.go) with
// ParkReasonVaultLocked, and every successful unlock resumes every run
// parked for that reason, oldest first, through the same resume door
// (ResolveApproval). The step is re-run after the resume; a vault that
// locked again in between parks the run afresh at the next secret read.

const (
	// ParkReasonVaultLocked is PendingApproval.Reason for a run waiting
	// on the vault; RunSummary.Resolution reads ResolutionResumed once
	// an unlock let it continue.
	ParkReasonVaultLocked = "vault-locked"
	ResolutionResumed     = "resumed"
	resolutionStopped     = "stopped"
	// vaultWaitTimeout bounds the durable Recv only because the engine
	// requires a deadline: a locked vault is not an unattended ask to
	// fail closed (guardrailApprovalTimeout's reason), so the window is
	// far beyond any lock policy -- the next unlock resumes the run
	// whenever it comes.
	vaultWaitTimeout = 30 * 24 * time.Hour
)

// vaultWait is one run's live vault park -- what ResumeVaultWaits
// orders by, oldest first.
type vaultWait struct {
	NodeID   string
	ParkedAt time.Time
}

// RunWait is one park a step went through before it ran -- the
// receipt's "parked: vault-locked" record with its timestamps, derived
// from the engine's own step history (a step attempt that ended in the
// vault-locked error, followed by the attempt that ran) rather than a
// second store. ResumedAt is zero while the run is still waiting.
type RunWait struct {
	Reason    string    `json:"reason"`
	ParkedAt  time.Time `json:"parkedAt"`
	ResumedAt time.Time `json:"resumedAt,omitzero"`
}

// SetVaultLockedLookup wires "is the vault locked right now" -- the
// secret service owns that answer, and this service must not import
// it (.claude/rules/backend.md). Unwired (every standalone test) means
// never locked, so RunWorkflow's blocking path is unchanged there.
//
//wails:ignore
func (e *ExecutionService) SetVaultLockedLookup(fn func() bool) {
	e.vaultLocked = fn
}

// runStep is runWorkflow's per-node step runner: one checkpointed
// step, re-run after a vault wait. The step's error crosses the
// checkpoint as text, so the sentinel is matched by secret.IsVaultLocked
// on either side of a replay.
func (e *ExecutionService) runStep(ctx execution.Context, in runInput, stepID string, fn func() (composition.ExecContext, error)) (composition.ExecContext, error) {
	for {
		out, err := execution.RunAsStep(ctx, func(context.Context) (composition.ExecContext, error) {
			return fn()
		}, execution.WithStepName(stepID))
		if !secret.IsVaultLocked(err) {
			return out, err
		}
		if perr := e.parkForVault(ctx, nodeByID(in.Nodes, stepID)); perr != nil {
			return out, perr
		}
	}
}

func nodeByID(nodes []composition.Node, id string) composition.Node {
	for _, n := range nodes {
		if n.ID == id {
			return n
		}
	}
	return composition.Node{ID: id}
}

// parkForVault parks the run at node until an unlock resumes it (nil)
// or a person stops it / the window elapses (error). The pending record
// carries the step's identity only -- no payload, no rule: the card
// asks for an unlock, not a decision about the step.
func (e *ExecutionService) parkForVault(ctx execution.Context, node composition.Node) error {
	runID, _ := ctx.GetWorkflowID()
	pending := PendingApproval{
		NodeID:        node.ID,
		NodeTypeID:    node.NodeTypeID,
		NodeTypeLabel: nodeTypeLabel(node.NodeTypeID),
		Config:        node.Config,
		Reason:        ParkReasonVaultLocked,
	}
	e.vaultWaits.Store(runID, vaultWait{NodeID: node.ID, ParkedAt: time.Now()})
	defer e.vaultWaits.Delete(runID)

	decision, err := e.park(ctx, pending, vaultWaitTimeout)
	if err != nil {
		return fmt.Errorf("vault wait: %w", err)
	}
	if decision.NodeID == "" {
		e.resolvePark(ctx, pending, "timed out")
		return fmt.Errorf("vault wait: the vault stayed locked for %s", vaultWaitTimeout)
	}
	if !decision.Approve {
		e.resolvePark(ctx, pending, resolutionStopped)
		return fmt.Errorf("vault wait: %s", composition.CancelledByUserMessage)
	}
	e.resolvePark(ctx, pending, ResolutionResumed)
	return nil
}

func nodeTypeLabel(nodeTypeID string) string {
	for _, nt := range composition.NodeTypes() {
		if nt.ID == nodeTypeID {
			return nt.Label
		}
	}
	return ""
}

// ResumeVaultWaits resumes every run parked on the vault, oldest first
// -- the secret service's own after-unlock hook. Each resume is the
// same Send an approval is; a run whose next secret read finds the
// vault locked again simply parks again with a fresh card.
//
//wails:ignore
func (e *ExecutionService) ResumeVaultWaits() {
	for _, w := range e.vaultWaitsOldestFirst() {
		if !e.runIsLive(w.runID) {
			// Stopped while waiting: the engine marks the row cancelled
			// without waking the durable Recv, so the registry entry
			// outlives the run until that wait returns -- never resume
			// a run nobody is waiting on.
			continue
		}
		if err := e.ResolveApproval(w.runID, w.NodeID, true, nil, false); err != nil {
			slog.Warn("execution: resume run after unlock", "run", w.runID, "error", err)
			continue
		}
		dataevent.Emit("run", w.runID)
	}
}

// mayWaitForVault pre-scans a graph for a step that will read a stored
// secret while the vault is locked -- RunWorkflow returns immediately
// then (the pending state surfaces via RunSummary.Pending), so a Run
// click never hangs on the unlock the way it never hangs on an
// approval (mayRequireApproval).
func (e *ExecutionService) mayWaitForVault(workflowID string, nodes []composition.Node) bool {
	if e.vaultLocked == nil || !e.vaultLocked() {
		return false
	}
	for _, n := range nodes {
		if n.Kind == composition.KindTrigger || n.Kind == composition.KindDecision {
			continue
		}
		if stepReadsSecret(guardrailsvc.GuardrailStep(workflowID, n, composition.ExecContext{})) {
			return true
		}
	}
	return false
}

// stepReadsSecret reads the derived Attributes["secrets"] labels the
// guardrail step carries (guardrailsvc.GuardrailStep) -- the same
// answer a rule condition sees, so a step that will touch a secret can
// never block a Run click the live wait then contradicts.
func stepReadsSecret(step guardrail.Step) bool {
	attrs, _ := step.Env["Attributes"].(map[string]any)
	labels, _ := attrs["secrets"].([]string)
	return len(labels) > 0
}

type waitingRun struct {
	runID string
	vaultWait
}

// vaultWaitsOldestFirst snapshots the live vault waits in resume order.
func (e *ExecutionService) vaultWaitsOldestFirst() []waitingRun {
	var waits []waitingRun
	e.vaultWaits.Range(func(k, v any) bool {
		waits = append(waits, waitingRun{runID: k.(string), vaultWait: v.(vaultWait)})
		return true
	})
	sort.Slice(waits, func(i, j int) bool { return waits[i].ParkedAt.Before(waits[j].ParkedAt) })
	return waits
}

// runIsLive reports whether runID's row is still PENDING/ENQUEUED.
func (e *ExecutionService) runIsLive(runID string) bool {
	statuses, err := execution.ListWorkflows(e.ctx, execution.WithFilterWorkflowIDs(runID))
	if err != nil || len(statuses) == 0 {
		return false
	}
	return statuses[0].Status == execution.WorkflowStatusPending || statuses[0].Status == execution.WorkflowStatusEnqueued
}
