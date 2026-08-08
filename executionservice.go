package main

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/alicoding/mill/internal/adapters/execution"
	"github.com/alicoding/mill/internal/domain/composition"
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
}

// RunSummary is one run's headline state -- the row shape for a
// run-history list.
type RunSummary struct {
	RunID         string    `json:"runID"`
	WorkflowID    string    `json:"workflowID"`
	WorkflowLabel string    `json:"workflowLabel"`
	Status        string    `json:"status"`
	StartedAt     time.Time `json:"startedAt"`
	CompletedAt   time.Time `json:"completedAt"`
	Error         string    `json:"error"`
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
	ctx  execution.Context
	comp *CompositionService
}

// NewExecutionService builds and launches the durable-execution runtime
// backed by a local SQLite file at dbPath. Registration happens inside
// execution.New, before Launch, per that function's own doc comment.
func NewExecutionService(dbPath string, comp *CompositionService) (*ExecutionService, error) {
	e := &ExecutionService{comp: comp}
	ctx, err := execution.New("mill", dbPath, func(ctx execution.Context) {
		execution.RegisterWorkflow(ctx, e.runWorkflow, execution.WithWorkflowName(millRunWorkflowName))
	})
	if err != nil {
		return nil, err
	}
	e.ctx = ctx
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
	return composition.ExecuteWorkflowWithStepRunner(in.Nodes, in.Edges, in.Attributes, stepRunner)
}

// RunWorkflowDurable runs a composed workflow through the durable
// execution path -- every node's result is checkpointed and the run
// stays visible/redrivable afterward (ListRuns/GetRun/RedriveRun),
// unlike CompositionService.RunWorkflow's plain in-memory execution
// (left untouched -- this is an additive entry point, not a
// replacement, so the existing Composition/Runbook "Run" button and its
// e2e coverage are unaffected).
func (e *ExecutionService) RunWorkflowDurable(workflowID string) (RunSummary, error) {
	wf, ok := e.findWorkflow(workflowID)
	if !ok {
		return RunSummary{}, fmt.Errorf("unknown workflow: %s", workflowID)
	}

	runID := uuid.NewString()
	handle, err := execution.RunWorkflow(e.ctx, e.runWorkflow, runInput{
		WorkflowID: wf.ID,
		Nodes:      wf.Nodes,
		Edges:      wf.Edges,
		Attributes: wf.Attributes,
	}, execution.WithWorkflowID(runID))
	if err != nil {
		return RunSummary{}, fmt.Errorf("start run: %w", err)
	}

	// Blocking, like CompositionService.RunWorkflow's existing
	// synchronous UX -- Mill's node executions (clipboard/HTTP/MCP
	// calls) are sub-second to a few seconds, and every run's full step
	// history is durably queryable afterward regardless (ListRuns/
	// GetRun), so a live-streaming progress view isn't required for the
	// "see what happened" half of execution visibility this exists for.
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
// first -- the data behind an Executions-style run-history list.
func (e *ExecutionService) ListRuns() ([]RunSummary, error) {
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
		summaries = append(summaries, e.summaryFromStatus(st))
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
			} else {
				rs.Status = "succeeded"
				if out, ok := decodeAny[composition.ExecContext](s.Output); ok {
					rs.Output = out.Payload
				}
			}
		}
		view = append(view, rs)
	}

	return RunDetail{RunSummary: summary, Steps: view}, nil
}

// RedriveRun forks runID from the given node's step, reusing every
// earlier step's checkpointed output instead of re-executing it --
// Mill's "fix forward" mechanism (docs/adr/0004's Update), most useful
// after correcting a Connector/List/MCP Server's Configure-page setup
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

func (e *ExecutionService) summaryFor(runID string) (RunSummary, error) {
	statuses, err := execution.ListWorkflows(e.ctx, execution.WithFilterWorkflowIDs(runID))
	if err != nil {
		return RunSummary{}, fmt.Errorf("get run: %w", err)
	}
	if len(statuses) == 0 {
		return RunSummary{}, fmt.Errorf("no run with id %q", runID)
	}
	return e.summaryFromStatus(statuses[0]), nil
}

func (e *ExecutionService) summaryFromStatus(st execution.WorkflowStatus) RunSummary {
	in, _ := decodeAny[runInput](st.Input)
	label := in.WorkflowID
	if wf, ok := e.findWorkflow(in.WorkflowID); ok {
		label = wf.Label
	}
	errMsg := ""
	if st.Error != nil {
		errMsg = st.Error.Error()
	}
	return RunSummary{
		RunID:         st.ID,
		WorkflowID:    in.WorkflowID,
		WorkflowLabel: label,
		Status:        string(st.Status),
		StartedAt:     st.StartedAt,
		CompletedAt:   st.CompletedAt,
		Error:         errMsg,
	}
}
