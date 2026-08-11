package executionsvc

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/alicoding/mill/internal/adapters/execution"
	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/alicoding/mill/internal/domain/guardrail"
	"github.com/alicoding/mill/internal/services/compositionsvc"
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

// RunKind classifies why a run started (docs/adr/0008) -- "test" for a
// manual/UI-driven run (Composition's canvas Run button, the Runs page's
// own quick-run picker), "triggered" for a real external event
// (TriggerService's headless listeners; not wired to this path yet, see
// ADR-0008's own named follow-on). Not a DBOS SetWorkflowAttributes call
// -- travels in runInput alongside every other per-run value, the
// existing pattern this struct already uses.
type RunKind string

const (
	RunKindTest      RunKind = "test"
	RunKindTriggered RunKind = "triggered"
)

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
}

// RunStep is one node's recorded execution within a run, for the
// execution-visibility UI (docs/SPEC.md §3.2's "shows through the path
// ... where it stopped", researched from Oscilar/n8n). Status is
// "succeeded"/"failed"/"pending" -- pending means DBOS has no recorded
// step yet (the run never reached that node).
type RunStep struct {
	NodeID        string `json:"nodeID"`
	NodeTypeID    string `json:"nodeTypeID"`
	NodeTypeLabel string `json:"nodeTypeLabel"`
	Status        string `json:"status"`
	Output        string `json:"output"`
	Error         string `json:"error"`
	// GuardrailEffect/GuardrailRule surface the step's recorded
	// guardrail verdict (docs/adr/0022) -- what actually decided at run
	// time, decoded from the checkpointed guardrail step, never a
	// re-evaluation against possibly-changed rules. Empty when the
	// effect-class default allowed without any rule involved.
	GuardrailEffect string `json:"guardrailEffect,omitempty"`
	GuardrailRule   string `json:"guardrailRule,omitempty"`
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
}

// NewExecutionService builds and launches the durable-execution runtime
// backed by databaseURL (a DBOS-native DSN -- see execution.New's own
// doc comment for the sqlite-by-default, Postgres-by-config reasoning).
// Registration happens inside execution.New, before Launch, per that
// function's own doc comment.
func NewExecutionService(databaseURL string, comp *compositionsvc.CompositionService, guard *guardrailsvc.GuardrailService) (*ExecutionService, error) {
	e := &ExecutionService{comp: comp, guard: guard, cancelState: newCancelState()}
	ctx, err := execution.New("mill", databaseURL, func(ctx execution.Context) {
		execution.RegisterWorkflow(ctx, e.runWorkflow, execution.WithWorkflowName(millRunWorkflowName))
	})
	if err != nil {
		return nil, err
	}
	e.ctx = ctx
	// The guardrail gate (docs/adr/0022) hooks composition's walk here
	// -- the one place holding both the rules and the durable context.
	composition.SetGuardrailGate(e.guardrailGate)
	composition.SetApprovalWaiter(e.approvalWaiter)
	// docs/adr/0026: a running code-execution step publishes its live
	// procexec.Handle here so CancelRun can reach it from outside the
	// run (executionservice_cancel.go).
	composition.SetProcessRegistrar(e.registerProcess)
	return e, nil
}

// Shutdown stops the durable-execution runtime -- called from main.go on
// application shutdown so in-flight step checkpoints flush cleanly.
//
//wails:ignore
func (e *ExecutionService) Shutdown(timeout time.Duration) error {
	return execution.Shutdown(e.ctx, timeout)
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
	return composition.ExecuteWorkflowWithStepRunner(in.Nodes, in.Edges, in.Attributes, stepRunner,
		composition.ExecuteOptions{AttrValues: in.Values, RunContext: ctx})
}

// RunWorkflow is the one execution entrypoint for the running app
// (docs/adr/0008) -- every run, whether started from Composition's
// canvas, the Runs page's own quick-run picker, or (once TriggerService
// is wired to this path, ADR-0008's named follow-on) a real headless
// trigger, goes through here. Every node's result is checkpointed and
// the run stays visible/redrivable afterward (ListRuns/GetRun/
// RedriveRun) regardless of kind -- a "test" run gets exactly the same
// durability guarantees as a "triggered" one, only the Kind label
// differs. composition.ExecuteWorkflow (no DBOS, no checkpointing)
// still exists as the tested primitive internal/domain/composition's
// own unit tests call directly -- no Wails-bound service calls it
// anymore.
// values overrides this run's starting Attribute values, keyed by
// AttributeDef.Key (docs/adr/0008's test-input form) -- nil for a
// workflow with no declared Attributes, or any caller (TriggerService's
// headless fire path) that has no user-supplied values to offer.
func (e *ExecutionService) RunWorkflow(workflowID string, kind RunKind, values map[string]string) (RunSummary, error) {
	wf, ok := e.findWorkflow(workflowID)
	if !ok {
		return RunSummary{}, fmt.Errorf("unknown workflow: %s", workflowID)
	}

	// ADR-0021: a test run executes the draft head (the pre-publish
	// check); a triggered run executes the published snapshot and is
	// rejected on a disabled or never-published workflow.
	nodes, edges, attrs, version, err := composition.ResolveRunnable(wf, kind == RunKindTest, 0)
	if err != nil {
		return RunSummary{}, err
	}

	runID := uuid.NewString()
	handle, err := execution.RunWorkflow(e.ctx, e.runWorkflow, runInput{
		WorkflowID: wf.ID,
		Nodes:      nodes,
		Edges:      edges,
		Attributes: attrs,
		Kind:       kind,
		Values:     values,
		Version:    version,
	}, execution.WithWorkflowID(runID))
	if err != nil {
		return RunSummary{}, fmt.Errorf("start run: %w", err)
	}

	// Blocking -- matches the plain-Run UX this replaces (docs/adr/0008):
	// Mill's node executions (clipboard/HTTP/MCP calls) are sub-second to
	// a few seconds, and every run's full step history is durably
	// queryable afterward regardless (ListRuns/GetRun), so a
	// live-streaming progress view isn't required for the "see what
	// happened" half of execution visibility this exists for.
	// EXCEPT when the graph could park awaiting a guardrail approval
	// (docs/adr/0022): then return immediately with the run ID, so a
	// Run click never hangs on a human decision -- the pending state
	// surfaces via RunSummary.Pending instead.
	if e.mayRequireApproval(wf.ID, nodes) {
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

// ListRuns returns recent runs across every workflow, most recent
// first -- the data behind Activity's cross-workflow "did anything run"
// feed and any other surface needing every run regardless of which
// workflow it belongs to.
func (e *ExecutionService) ListRuns() ([]RunSummary, error) {
	return e.listRuns(nil)
}

// ListRunsForWorkflow returns recent runs for one workflow only, most
// recent first -- the data behind a workflow's own Runs tab
// (docs/SPEC.md §7's Update: durable-run visibility moved from a
// standalone page into the workflow it belongs to, per real precedent
// -- n8n/Retool/Airflow all scope this to the individual workflow's own
// page, never a global page reached via a workflow picker). DBOS has no
// native filter on runInput.WorkflowID (an arbitrary field inside the
// generically-serialized Input, not something ListWorkflows' own
// filters -- WithFilterWorkflowIDs et al. -- can query against), so this
// filters post-decode the same way summaryFromStatus already decodes
// runInput for every other field.
func (e *ExecutionService) ListRunsForWorkflow(workflowID string) ([]RunSummary, error) {
	return e.listRuns(&workflowID)
}

func (e *ExecutionService) listRuns(filterWorkflowID *string) ([]RunSummary, error) {
	statuses, err := execution.ListWorkflows(e.ctx,
		execution.WithFilterName(millRunWorkflowName),
		execution.WithFilterSortDesc(),
		execution.WithFilterLimit(50),
	)
	if err != nil {
		return nil, fmt.Errorf("list runs: %w", err)
	}

	summaries := make([]RunSummary, 0, len(statuses))
	for _, st := range statuses {
		summary := e.summaryFromStatus(st)
		if filterWorkflowID != nil && summary.WorkflowID != *filterWorkflowID {
			continue
		}
		summaries = append(summaries, summary)
	}
	return summaries, nil
}

// GetRun returns one run's full per-node step breakdown, joined against
// its workflow definition's current Nodes (by ID) for display labels --
// falls back to a bare step list (no labels) if the definition was
// since edited/deleted, rather than failing the whole call over
// missing display metadata.
func (e *ExecutionService) GetRun(runID string) (RunDetail, error) {
	summary, err := e.summaryFor(runID)
	if err != nil {
		return RunDetail{}, err
	}

	steps, err := execution.GetWorkflowSteps(e.ctx, runID)
	if err != nil {
		return RunDetail{}, fmt.Errorf("get run steps: %w", err)
	}

	wf, haveWF := e.findWorkflow(summary.WorkflowID)
	byID := make(map[string]composition.Node, len(wf.Nodes))
	if haveWF {
		for _, n := range wf.Nodes {
			byID[n.ID] = n
		}
	}
	typeLabels := make(map[string]string)
	for _, nt := range composition.NodeTypes() {
		typeLabels[nt.ID] = nt.Label
	}

	byNodeID := make(map[string]execution.StepInfo, len(steps))
	for _, s := range steps {
		byNodeID[s.StepName] = s
	}

	var view []RunStep
	// Walk the definition's own node order when available so pending
	// (not-yet-reached) nodes show up too, not just what DBOS recorded.
	order := wf.Nodes
	if !haveWF {
		order = nil
		for _, s := range steps {
			order = append(order, composition.Node{ID: s.StepName})
		}
	}
	for _, n := range order {
		if n.Kind == composition.KindTrigger || n.Kind == composition.KindDecision {
			continue
		}
		rs := RunStep{NodeID: n.ID, NodeTypeID: n.NodeTypeID, NodeTypeLabel: typeLabels[n.NodeTypeID], Status: "pending"}
		if s, ok := byNodeID[n.ID]; ok {
			if s.Error != nil {
				rs.Status = "failed"
				rs.Error = s.Error.Error()
				// A code-execution step killed via CancelRun records a
				// distinct status (docs/adr/0026: "cancelled != failed !=
				// interrupted") -- matched by message, not error identity,
				// since a checkpointed step's error crosses a DBOS
				// JSON round trip (decodeAny's own doc comment) that
				// only preserves Error(), never Go type/errors.Is.
				if strings.Contains(rs.Error, composition.CancelledByUserMessage) {
					rs.Status = "cancelled"
				}
			} else {
				rs.Status = "succeeded"
				if out, ok := decodeAny[composition.ExecContext](s.Output); ok {
					rs.Output = out.Payload
				}
			}
		}
		// Join the step's recorded guardrail verdict (docs/adr/0022) --
		// checkpointed under its own "guardrail:<nodeID>" step name.
		if g, ok := byNodeID["guardrail:"+n.ID]; ok && g.Error == nil {
			if v, ok := decodeAny[guardrail.Verdict](g.Output); ok {
				rs.GuardrailEffect = string(v.Effect)
				rs.GuardrailRule = v.RuleLabel
				if v.Effect == guardrail.EffectDeny && rs.Status == "pending" {
					rs.Status = "denied"
				}
			}
		}
		if summary.Pending != nil && summary.Pending.NodeID == n.ID {
			rs.Status = "awaiting-approval"
		}
		view = append(view, rs)
	}

	return RunDetail{RunSummary: summary, Steps: view}, nil
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
