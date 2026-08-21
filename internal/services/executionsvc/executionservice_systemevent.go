package executionsvc

import (
	"log/slog"
	"time"

	"github.com/alicoding/mill/internal/adapters/execution"
	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/alicoding/mill/internal/domain/trigger"
)

// System events (docs/adr/0035, SPEC.md §3.4's Group D unparked): Mill's
// own execution engine dogfoods its own trigger surface instead of a
// bespoke Go code path per "the app does X on event Y" -- the exact
// violation ADR-0035 was written to fix (ForwardPendingApproval's
// private send path). A trigger-system-event NodeType
// (internal/domain/composition/triggers.go) arms via TriggerService,
// which installs itself here as the dispatch sink -- ExecutionService,
// the producer, never imports triggersvc, the consumer; main.go wires
// them together (mirrors composition.SetConnectorLookup's own injected-
// function shape, .claude/rules/backend.md).

// SystemEventKind is one of the four internal events trigger-system-event
// can fire on.
type SystemEventKind string

const (
	SystemEventDecisionParked SystemEventKind = "decision-parked"
	SystemEventRunCompleted   SystemEventKind = "run-completed"
	SystemEventRunFailed      SystemEventKind = "run-failed"
	SystemEventRunCancelled   SystemEventKind = "run-cancelled"
	// SystemEventUpdateAvailable fires when an update check finds a
	// newer release on this install's channel (goal 0146) -- the
	// composed door for "tell me when there's an update".
	SystemEventUpdateAvailable SystemEventKind = "update-available"
)

// SystemEvent is the typed payload a trigger-system-event fire carries as
// its InitialPayload (JSON-encoded) -- documented on the NodeType's own
// Output description.
type SystemEvent struct {
	Event         SystemEventKind `json:"event"`
	RunID         string          `json:"runId"`
	WorkflowID    string          `json:"workflowId"`
	WorkflowLabel string          `json:"workflowLabel"`
	// NodeID is only set for SystemEventDecisionParked -- the parked
	// node's ID. Empty for the three run-terminal events, which aren't
	// about any one node.
	NodeID    string    `json:"nodeId,omitempty"`
	Timestamp time.Time `json:"timestamp"`
	// Version/Channel are set only for update-available (omitempty
	// keeps every other event's payload byte-identical).
	Version string `json:"version,omitempty"`
	Channel string `json:"channel,omitempty"`
}

// SetSystemEventSink installs the dispatch seam. A nil sink (every
// standalone Go test that constructs ExecutionService directly, same as
// composition.guardrailGate's own "nil means no gating" default) means
// system events are simply dropped -- there's nothing wired to hear
// them.
//
//wails:ignore
func (e *ExecutionService) SetSystemEventSink(sink func(SystemEvent)) {
	e.systemEventSink = sink
}

// SetRunCompletionSink installs goal 0061 slice C's run-completion seam
// -- see the runCompletionSink field's own doc comment
// (executionservice.go) for what it's for and why it's separate from
// the system-event sink above (that one dispatches a trigger-system-
// event NodeType's own fire, gated by the loop rule emitSystemEvent
// applies; this one is a plain, ungated "a run finished" notification
// atlassvc needs regardless of what triggers exist).
//
//wails:ignore
func (e *ExecutionService) SetRunCompletionSink(sink func(runID string, succeeded bool)) {
	e.runCompletionSink = sink
}

// emitSystemEvent looks up runID's own recorded input to resolve which
// workflow/label fired kind, and applies the loop rule (docs/adr/0035
// item 4, n8n's Error-Trigger precedent): a run whose OWN root trigger is
// trigger-system-event never emits a system event of its own, so a chain
// bottoms out after exactly one hop instead of recursing. Called from
// three sites -- parkForApproval (decision-parked), runWorkflow
// (run-completed/run-failed), CancelRun (run-cancelled) -- one shared
// implementation rather than three, since all three only ever have a
// runID and need the identical resolve-then-check-then-dispatch
// sequence. Errors resolving runID are logged and swallowed, never
// propagated -- system-event dispatch is best-effort, the same posture
// emitGuardrailPendingChanged/emitHotkeyActivity already take for their
// own frontend-event emission.
func (e *ExecutionService) emitSystemEvent(kind SystemEventKind, runID, nodeID string) {
	if e.systemEventSink == nil {
		return
	}
	statuses, err := execution.ListWorkflows(e.ctx, execution.WithFilterWorkflowIDs(runID))
	if err != nil || len(statuses) == 0 {
		slog.Error("system-event: resolve run", "run", runID, "event", kind, "error", err)
		return
	}
	in, ok := decodeAny[runInput](statuses[0].Input)
	if !ok {
		return
	}
	if rootType, _, hasTrigger := trigger.ExtractTrigger(composition.Workflow{Nodes: in.Nodes, Edges: in.Edges}); hasTrigger && rootType == "trigger-system-event" {
		return
	}
	label := in.WorkflowID
	if wf, ok := e.findWorkflow(in.WorkflowID); ok {
		label = wf.Label
	}
	e.systemEventSink(SystemEvent{
		Event: kind, RunID: runID, WorkflowID: in.WorkflowID, WorkflowLabel: label,
		NodeID: nodeID, Timestamp: time.Now().UTC(),
	})
}
