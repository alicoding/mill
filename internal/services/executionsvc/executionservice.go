// Package executionsvc is the Wails-facing layer that runs a workflow:
// durable execution via DBOS (internal/adapters/execution), the
// guardrail gate checked before every guarded step (guardrailsvc), run
// history/receipts, and cancellation. It owns orchestration state a
// stateless domain package can't hold; per-node-type execution
// semantics live in internal/domain/composition.
package executionsvc

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/alicoding/mill/internal/adapters/execution"
	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/alicoding/mill/internal/services/compositionsvc"
	"github.com/alicoding/mill/internal/services/dataevent"
	"github.com/alicoding/mill/internal/services/guardrailsvc"
	"github.com/google/uuid"
)

// decodeAny re-decodes a DBOS-stored `any` value into T. Verified
// directly against a real run (not assumed from the Serializer
// interface's doc comments alone): WorkflowStatus.Input/Output and
// StepInfo.Output all come back as the raw JSON *string* DBOS's default
// serializer stored, not an already-decoded Go value -- a direct type
// assertion to T fails even though the data is really there, and so
// would blindly re-marshaling a string (json.Marshal on a Go string
// wraps it in quotes, corrupting the payload before Unmarshal ever
// sees it). The nil/non-string branch is defensive for any future
// caller that hands this a value DBOS already decoded.
func decodeAny[T any](v any) (T, bool) {
	var zero, out T
	if v == nil {
		return zero, false
	}
	raw, ok := v.(string)
	if !ok {
		rawBytes, err := json.Marshal(v)
		if err != nil {
			return zero, false
		}
		raw = string(rawBytes)
	}
	if err := json.Unmarshal([]byte(raw), &out); err != nil {
		return zero, false
	}
	return out, true
}

// millRunWorkflowName pins ExecutionService.runWorkflow's registered
// DBOS name -- see execution.WithWorkflowName's own doc comment for why
// this isn't left to derive from the bound method's runtime name.
const millRunWorkflowName = "mill.run-workflow"

// runInput is one durable run's DBOS workflow input -- WorkflowID is the
// composition.Workflow definition this run executes; the graph itself
// (Nodes/Edges/Attributes) travels alongside it so a run's own
// checkpointed history stays self-contained even if the definition is
// later edited or deleted, matching docs/adr/0004's "resume-without-
// re-execution" mapping.
type runInput struct {
	WorkflowID string
	Nodes      []composition.Node
	Edges      []composition.Edge
	Attributes []composition.AttributeDef
	Kind       RunKind
	// Values overrides the run's starting Attribute values (docs/adr/0008's
	// test-input form) -- keyed by AttributeDef.Key, same map[string]string
	// shape every other config value in this codebase already uses. Nil
	// (a "Run" click on a workflow with no declared Attributes, or any
	// caller that hasn't adopted the test-input form yet) behaves exactly
	// as before this field existed.
	Values map[string]string
	// Version records which definition snapshot this run executed
	// (docs/adr/0021) -- 0 means the draft head (a test run).
	Version int
	// Payload seeds the run's starting ExecContext.Payload
	// (composition.ExecuteOptions.InitialPayload) -- a headless trigger
	// fire's own event data (docs/SPEC.md §3.4's Trigger row), e.g. a
	// filesystem-watch trigger's changed file path. Empty for every run
	// started before this field existed (an already-persisted runInput
	// decodes it as "", identical to today's behavior) and for every
	// caller with nothing to offer (a manual/hotkey/schedule/clipboard-
	// watch fire, RunWorkflow's own zero-payload delegation below).
	Payload string
	// Stepped starts this run in debug "step mode" (docs/adr/0031 §5):
	// the guardrail gate parks before every node. False for every run
	// started before this field existed. Only RunWorkflowStepped sets
	// it true.
	Stepped bool
	// AtlasSourceCardID names the card whose write fired trigger-atlas-card
	// to start this run, "" otherwise (executionservice_atlascard.go).
	AtlasSourceCardID string
	// SecretsToken correlates this run to codeloopsvc's own in-memory
	// typed-secrets stash (goal 0240 S2, composition.ExecContext's own
	// field doc comment) -- an opaque, meaningless-without-the-stash
	// token, never the secret value itself, so persisting it as part of
	// this durably-checkpointed input is harmless. "" for every run
	// started before this field existed and every caller with no typed
	// secrets to correlate (RunWorkflow/RunWorkflowWithPayload/
	// RunWorkflowStepped's own zero-value delegation below).
	SecretsToken string
}

// RunStep is one node's recorded execution within a run, for the
// execution-visibility UI (docs/SPEC.md §3.2's "shows through the path
// ... where it stopped", researched from n8n). Status is
// "succeeded"/"failed"/"pending" -- pending means DBOS has no recorded
// step yet (the run never reached that node).
type RunStep struct {
	NodeID        string `json:"nodeID"`
	NodeTypeID    string `json:"nodeTypeID"`
	NodeTypeLabel string `json:"nodeTypeLabel"`
	Status        string `json:"status"`
	// Input/InputAttributes are this step's recorded INPUT (docs/adr/0031
	// item 3): the immediately-preceding EXECUTED step's own recorded
	// Payload/Attributes, or the run's own seeded starting values for
	// the first executed step. No omitempty on Input, matching Output
	// below (goal 0021 gap 3): omitempty on a genuinely-empty first
	// step dropped the JSON key entirely over MCP, indistinguishable
	// from a real mapping bug.
	Input           string         `json:"input"`
	InputAttributes map[string]any `json:"inputAttributes,omitempty"`
	Output          string         `json:"output"`
	// OutputAttributes is this step's Attributes bag AFTER it ran --
	// the DBOS checkpoint already stores the full ExecContext
	// (Payload+Attributes), but only Payload was ever decoded into
	// Output; Attributes was silently discarded until now.
	OutputAttributes map[string]any `json:"outputAttributes,omitempty"`
	Error            string         `json:"error"`
	// GuardrailEffect/GuardrailRule surface the step's recorded
	// guardrail verdict (docs/adr/0022) -- what actually decided at run
	// time, decoded from the checkpointed guardrail step, never a
	// re-evaluation against possibly-changed rules. Empty when the
	// effect-class default allowed without any rule involved.
	GuardrailEffect string `json:"guardrailEffect,omitempty"`
	GuardrailRule   string `json:"guardrailRule,omitempty"`
	// GuardrailSource mirrors the recorded verdict's Source
	// (guardrail.SourceDebug for a breakpoint/step-mode park, "" for
	// policy) -- the Runs tab's own distinct debug badge (docs/adr/0031
	// item 2), never conflated with the policy shield.
	GuardrailSource string `json:"guardrailSource,omitempty"`
}

// RunSummary is one run's headline state -- the row shape for a
// run-history list.
type RunSummary struct {
	RunID         string    `json:"runID"`
	WorkflowID    string    `json:"workflowID"`
	WorkflowLabel string    `json:"workflowLabel"`
	Status        string    `json:"status"`
	Kind          RunKind   `json:"kind"`
	Output        string    `json:"output"`
	StartedAt     time.Time `json:"startedAt"`
	CompletedAt   time.Time `json:"completedAt"`
	Error         string    `json:"error"`
	// Version is which definition snapshot executed (docs/adr/0021) --
	// 0 means the draft head (a test run).
	Version int `json:"version"`
	// Pending is the run's live awaiting-approval state, if any
	// (docs/adr/0022) -- non-nil only while a guardrail ask is parked.
	Pending *PendingApproval `json:"pending,omitempty"`
	// Resolution is a completed run's approval outcome ("approved"/
	// "denied"/"timed out"), empty when the run never parked -- the
	// Review queue's recently-resolved section (goal 0002).
	Resolution string `json:"resolution,omitempty"`
	// Interrupted marks a run that was parked on an approval when Mill
	// relaunched under a different WorkflowCodeVersion and so could not
	// be recovered -- ReconcileInterrupted cancelled it at startup
	// (executionservice_reconcile.go). Distinct from a person stopping
	// a run: nobody answered, the answer became unanswerable.
	Interrupted bool `json:"interrupted,omitempty"`
	// Values are the attribute values this run was invoked with
	// (runInput.Values -- a test form's input, or a parent's resolved
	// child bindings). The data behind Activity's per-attribute columns
	// and attribute search (docs/SPEC.md §3.2's analytics pattern).
	Values map[string]string `json:"values"`
}

// RunDetail is a RunSummary plus its full per-node step breakdown.
type RunDetail struct {
	RunSummary
	Steps []RunStep `json:"steps"`
}

// ExecutionService is the Wails-facing layer over
// internal/adapters/execution's durable-workflow runtime -- it holds no
// domain logic of its own (that's composition.ExecuteWorkflowWithStepRunner),
// only the DBOS wiring and the Mill-specific run/step shapes a stateless
// adapter package can't own, mirroring CompositionService's own split.
// See docs/adr/0004's Update for the full workflow/step mapping this
// implements.
type ExecutionService struct {
	ctx   execution.Context
	comp  *compositionsvc.CompositionService
	guard *guardrailsvc.GuardrailService
	// cancelState (executionservice_cancel.go) holds the live-process
	// registry docs/adr/0026's cancellation design needs -- embedded
	// rather than a named field since callers never reach through it
	// directly, only via CancelRun/registerProcess.
	cancelState
	// parkedRuns is the live-park registry: runID -> nodeID for every
	// run parked on Recv inside THIS process. A run whose row says
	// PENDING but which is absent here has no listener, so a Send would
	// be accepted by the database and never received -- ResolveApproval
	// answers instead of silently doing nothing
	// (executionservice_guardrail.go).
	parkedRuns sync.Map
	// minutesSavedLookup resolves a workflow's current "minutes saved
	// per run" estimate -- SettingsService's own persisted preference
	// (docs/SPEC.md §3.7), wired in from main.go via
	// SetMinutesSavedLookup, same injected-function-seam shape as
	// composition.SetHTTPRequestLookup (.claude/rules/backend.md: data
	// another layer owns, not a direct cross-service import). Nil until
	// wired (e.g. a standalone Go test constructing ExecutionService
	// directly) -- minutesSavedFor (executionservice_home.go) falls back
	// to defaultMinutesSavedPerRun in that case.
	minutesSavedLookup func(workflowID string) int
	// systemEventSink is the injected dispatch seam for docs/adr/0035's
	// trigger-system-event family -- see executionservice_systemevent.go.
	// Wired from main.go via SetSystemEventSink once TriggerService
	// exists; nil in every standalone test that builds ExecutionService
	// directly, same as minutesSavedLookup above.
	systemEventSink func(SystemEvent)
	// runCompletionSink is goal 0061 slice C's run-completion seam
	// (ADR-0038 decision 4) -- called from runWorkflow for EVERY run's
	// completion, success or failure, so atlassvc's UpdateNow can stamp
	// a card's LastSyncedAt whenever its "Update now" run actually
	// succeeds, however long that takes (including a run that parked
	// for guardrail approval and resolved long after the call that
	// started it returned). Wired from main.go via
	// SetRunCompletionSink; nil in every standalone test, same as
	// systemEventSink above.
	runCompletionSink func(runID string, succeeded bool)
	// version is the app version string a run receipt's Build field
	// stamps (executionservice_receipt.go) -- set via SetVersion once
	// main.go's millVersion const is available; empty in every
	// standalone test that builds ExecutionService directly, same as
	// minutesSavedLookup/systemEventSink above.
	version string
	// appVersion is the durable runtime's own application version --
	// WorkflowCodeVersion in production, a test-supplied value via
	// NewExecutionServiceWithVersion. Every "was this row written by
	// this code?" comparison reads this, never the const directly, so a
	// test relaunching one database under two versions gets honest
	// answers from both services.
	appVersion string
}

// runWorkflow is the one DBOS-registered durable workflow function --
// every Mill workflow run, regardless of which composition.Workflow
// definition it executes, goes through this single registration
// (RunWorkflow's input carries which graph to run). Its body wraps each
// node's execution in a checkpointed DBOS step, keyed by the node's own
// ID (execution.WithStepName), via composition's injected StepRunner
// seam -- composition itself never imports DBOS (domain purity).
func (e *ExecutionService) runWorkflow(ctx execution.Context, in runInput) (string, error) {
	stepRunner := func(stepID string, fn func() (composition.ExecContext, error)) (composition.ExecContext, error) {
		return execution.RunAsStep(ctx, func(context.Context) (composition.ExecContext, error) {
			return fn()
		}, execution.WithStepName(stepID))
	}
	output, err := composition.ExecuteWorkflowWithStepRunner(in.Nodes, in.Edges, in.Attributes, stepRunner,
		composition.ExecuteOptions{
			AttrValues: in.Values, RunContext: ctx, InitialPayload: in.Payload,
			// WorkflowID was never threaded through here before this
			// change -- a real, previously-latent bug found while
			// building breakpoints (docs/adr/0031): every workflow- and
			// node-instance-scoped guardrail rule (ADR-0019's third
			// scope, which a breakpoint IS) evaluated against an always-
			// empty WorkflowID and so could never actually match at run
			// time, even though guardrailservice.go's dry-run tester
			// (which does pass workflowID) reported the rule as live.
			// Fixed here, load-bearing for this feature, not a
			// speculative unrelated cleanup.
			WorkflowID:   in.WorkflowID,
			Stepped:      in.Stepped,
			SecretsToken: in.SecretsToken,
		})

	// run-completed/run-failed (docs/adr/0035 item 4): emitted HERE, not
	// at an observation call site (RunWorkflow's own GetResult, or
	// TriggerService.fire's summary read), because this DBOS-registered
	// function is the one place that runs to completion for EVERY run
	// regardless of how it started or whether anything is still awaiting
	// its result -- a run that parked and later resumed asynchronously
	// (a human approving hours later) finishes here too, long after
	// RunWorkflowStart's own caller already returned. One emission point
	// covers both "the GetResult completion path AND triggerservice's
	// fire completion" the goal names, since both are downstream of this
	// same function. run-cancelled is deliberately NOT decided here --
	// CancelRun (executionservice_cancel.go) emits it directly, since
	// that's the synchronous, user-initiated stop path; skip here (via
	// the CancelledByUserMessage marker, the same one
	// executionservice_getrun.go already uses to tell "cancelled" apart
	// from "failed" at the step level) so a cancelled run isn't ALSO
	// reported as failed.
	runID, _ := ctx.GetWorkflowID()
	switch {
	case err == nil:
		e.emitSystemEvent(SystemEventRunCompleted, runID, "")
		if e.runCompletionSink != nil {
			e.runCompletionSink(runID, true)
		}
	case strings.Contains(err.Error(), composition.CancelledByUserMessage):
		// CancelRun already emitted run-cancelled for this runID.
	default:
		e.emitSystemEvent(SystemEventRunFailed, runID, "")
		if e.runCompletionSink != nil {
			e.runCompletionSink(runID, false)
		}
	}
	// Live-sync counterpart of runWorkflowStart's start emit, placed
	// here for the same reason as the system events above: every run
	// finishes through this function (including a parked run resumed
	// hours later), so open run lists refresh to the final status
	// without a reload. Unconditional -- cancelled and failed rows go
	// stale exactly like successful ones.
	dataevent.Emit("run", runID)
	return output, err
}

func (e *ExecutionService) runWorkflowStart(workflowID string, kind RunKind, values map[string]string, payload string, stepped bool, atlasSourceCardID string, secretsToken string) (RunSummary, error) {
	wf, ok := e.findWorkflow(workflowID)
	if !ok {
		return RunSummary{}, fmt.Errorf("unknown workflow: %s", workflowID)
	}

	// ADR-0021: a test or MCP run executes the draft head (the
	// pre-publish check, RunKind.runsDraft); a triggered run executes
	// the published snapshot and is rejected on a disabled or
	// never-published workflow.
	nodes, edges, attrs, version, err := composition.ResolveRunnable(wf, kind.runsDraft(), 0)
	if err != nil {
		return RunSummary{}, err
	}

	if err := preflightRefusal(nodes, edges, attrs); err != nil {
		return RunSummary{}, err
	}

	runID := uuid.NewString()
	handle, err := execution.RunWorkflow(e.ctx, e.runWorkflow, runInput{
		WorkflowID:        wf.ID,
		Nodes:             nodes,
		Edges:             edges,
		Attributes:        attrs,
		Kind:              kind,
		Values:            values,
		Version:           version,
		Payload:           payload,
		Stepped:           stepped,
		AtlasSourceCardID: atlasSourceCardID,
		SecretsToken:      secretsToken,
	}, execution.WithWorkflowID(runID))
	if err != nil {
		return RunSummary{}, fmt.Errorf("start run: %w", err)
	}

	// Live-sync (goal 0017, docs/adr/0025): announce the new run so an
	// already-open Runs panel shows it without a remount -- the panel
	// listens for mill-data-changed{entity:"run"} and stays mounted
	// across section-tab switches, so a missing start emit leaves it
	// stale until a full reload. Completion emits from runWorkflow
	// itself (the one point every run finishes through).
	dataevent.Emit("run", runID)

	// Blocking -- matches the plain-Run UX this replaces (docs/adr/0008):
	// Mill's node executions (clipboard/HTTP/MCP calls) are sub-second to
	// a few seconds, and every run's full step history is durably
	// queryable afterward regardless (ListRuns/GetRun), so a
	// live-streaming progress view isn't required for the "see what
	// happened" half of execution visibility this exists for.
	// EXCEPT when the graph could park awaiting a guardrail approval
	// (docs/adr/0022), or this is a stepped run (guaranteed to park at
	// its very first node, docs/adr/0031): then return immediately with
	// the run ID, so a Run click never hangs on a human decision -- the
	// pending state surfaces via RunSummary.Pending instead.
	if stepped || e.mayRequireApproval(wf.ID, nodes) {
		return e.summaryFor(handle.GetWorkflowID())
	}
	if _, err := handle.GetResult(); err != nil {
		// Not returned as a Go error -- a failed *run* is a normal,
		// inspectable/redrivable outcome (that's the whole point of
		// this endpoint), not a call failure. The summary's own Status/
		// Error fields carry it.
		_ = err
	}

	return e.summaryFor(handle.GetWorkflowID())
}

// RedriveRun forks runID from the given node's step, reusing every
// earlier step's checkpointed output instead of re-executing it --
// Mill's "fix forward" mechanism (docs/adr/0004's Update), most useful
// after correcting an HTTPRequest/List/MCP Server's Configure-page setup
// in between, since those resolve live at execution time.
func (e *ExecutionService) RedriveRun(runID, fromNodeID string) (RunSummary, error) {
	steps, err := execution.GetWorkflowSteps(e.ctx, runID)
	if err != nil {
		return RunSummary{}, fmt.Errorf("get run steps: %w", err)
	}
	var stepID uint
	found := false
	for _, s := range steps {
		if s.StepName == fromNodeID {
			stepID = uint(s.StepID)
			found = true
			break
		}
	}
	if !found {
		return RunSummary{}, fmt.Errorf("run %s has no recorded step for node %s", runID, fromNodeID)
	}

	forkedID := uuid.NewString()
	handle, err := execution.ForkWorkflow[string](e.ctx, execution.ForkWorkflowInput{
		OriginalWorkflowID: runID,
		ForkedWorkflowID:   forkedID,
		StartStep:          stepID,
	})
	if err != nil {
		return RunSummary{}, fmt.Errorf("redrive: %w", err)
	}
	// The fork enters DBOS via ForkWorkflow, not runWorkflowStart, so the
	// latter's own start emit never fires for forkedID -- announce it
	// here so an open Runs panel shows the redriven run immediately
	// rather than only once it completes (runWorkflow's own completion
	// emit still covers that half).
	dataevent.Emit("run", forkedID)
	if _, err := handle.GetResult(); err != nil {
		_ = err // see RunWorkflowDurable's identical comment
	}
	return e.summaryFor(handle.GetWorkflowID())
}

func (e *ExecutionService) findWorkflow(workflowID string) (composition.Workflow, bool) {
	for _, wf := range e.comp.Workflows() {
		if wf.ID == workflowID {
			return wf, true
		}
	}
	return composition.Workflow{}, false
}
