// Package execution wraps github.com/dbos-inc/dbos-transact-golang's
// durable-workflow API behind Mill's own names, per CLAUDE.md's
// ports/adapters rule -- no other Mill package imports
// "github.com/dbos-inc/dbos-transact-golang/dbos" directly, same shape
// internal/adapters/mcpclient already uses for the MCP Go SDK. This
// file re-exports only the handful of types/functions Mill actually
// calls, the same pattern DBOS's own dbos/aliases.go uses internally
// for its public-vs-internal split -- not invented here. The four
// generic operations (RegisterWorkflow/RunWorkflow/RunAsStep/
// ForkWorkflow) are thin func wrappers, not var aliases -- a var can't
// carry unresolved type parameters, so executionservice.go still needs
// to be able to instantiate them with its own P/R types.
package execution

import (
	"time"

	"github.com/dbos-inc/dbos-transact-golang/dbos"
)

type (
	// Context is a launched DBOS runtime handle -- the first argument to
	// every durable operation below.
	Context = dbos.Context

	// Workflow is a durable workflow function's shape: input P, result R.
	Workflow[P any, R any] = dbos.Workflow[P, R]

	// Step is a durable step function's shape.
	Step[R any] = dbos.Step[R]

	// WorkflowHandle is the result of RunWorkflow/ForkWorkflow -- carries
	// the new run's ID and lets a caller block for its result.
	WorkflowHandle[R any] = dbos.WorkflowHandle[R]

	// WorkflowStatus is a snapshot of one run: status, timestamps,
	// input/output. Returned by ListWorkflows.
	WorkflowStatus = dbos.WorkflowStatus

	// StepInfo describes one recorded step of a run, as returned by
	// GetWorkflowSteps -- StepID/StepName/Output/Error map directly onto
	// a Mill graph Node by ID (executionservice.go names each step after
	// its Node.ID).
	StepInfo = dbos.StepInfo

	// ForkWorkflowInput is Redrive's underlying mechanism -- fork a run
	// from a given step, reusing every earlier step's checkpointed
	// output instead of re-executing it (docs/adr/0004's Update).
	ForkWorkflowInput = dbos.ForkWorkflowInput

	// StepOption configures one RunAsStep call -- Mill only ever sets
	// the step's name (WithStepName, below).
	StepOption = dbos.StepOption

	// WorkflowOption configures one RunWorkflow call -- Mill only ever
	// sets the workflow's own ID (WithWorkflowID, below).
	WorkflowOption = dbos.WorkflowOption

	// WorkflowRegistrationOption configures one RegisterWorkflow call --
	// unused by Mill today (no caller passes one), kept for signature
	// compatibility with dbos.RegisterWorkflow.
	WorkflowRegistrationOption = dbos.WorkflowRegistrationOption

	// ListWorkflowsOption configures one ListWorkflows call.
	ListWorkflowsOption = dbos.ListWorkflowsOption
)

// RegisterWorkflow registers ctx's durable workflow function -- must be
// called before Launch (DBOS resolves a workflow by registered function
// identity for crash recovery).
func RegisterWorkflow[P any, R any](ctx Context, fn Workflow[P, R], opts ...WorkflowRegistrationOption) {
	dbos.RegisterWorkflow(ctx, fn, opts...)
}

// RunWorkflow starts (or resumes, if the ID already exists) a durable
// run of the registered workflow function.
func RunWorkflow[P any, R any](ctx Context, fn Workflow[P, R], input P, opts ...WorkflowOption) (WorkflowHandle[R], error) {
	return dbos.RunWorkflow(ctx, fn, input, opts...)
}

// RunAsStep checkpoints one node's execution -- fn's result is cached
// against (workflow ID, step name); a later call with the same pair
// returns the cached result without invoking fn again.
func RunAsStep[R any](ctx Context, fn Step[R], opts ...StepOption) (R, error) {
	return dbos.RunAsStep(ctx, fn, opts...)
}

// ForkWorkflow starts a new run that reuses an original run's
// checkpointed steps before StartStep and re-executes from there --
// Mill's redrive mechanism.
func ForkWorkflow[R any](ctx Context, input ForkWorkflowInput) (WorkflowHandle[R], error) {
	return dbos.ForkWorkflow[R](ctx, input)
}

// Send delivers a message to a running workflow's topic from outside it
// (or durably from inside another workflow) -- the guardrail approval
// path's wake-up call (docs/adr/0022): ResolveApproval Sends the
// human's decision to the parked run.
func Send[P any](ctx Context, destinationID string, message P, topic string) error {
	return dbos.Send(ctx, destinationID, message, topic)
}

// Recv blocks inside a workflow until a message arrives on topic or the
// timeout lapses -- a durable, exactly-once, checkpointed operation
// (verified against the installed DBOS source, not assumed): a parked
// approval survives the process dying and replays without re-asking.
func Recv[R any](ctx Context, topic string, timeout time.Duration) (R, error) {
	return dbos.Recv[R](ctx, topic, timeout)
}

// SetEvent publishes a key/value from inside a running workflow for
// outside observers -- how a parked run advertises which step awaits
// approval (docs/adr/0022).
func SetEvent[P any](ctx Context, key string, message P) error {
	return dbos.SetEvent(ctx, key, message)
}

// GetEvent reads a workflow's published event value from outside it,
// waiting up to timeout (0 polls the current value) -- how run
// summaries surface a pending approval without joining the run.
func GetEvent[R any](ctx Context, targetWorkflowID, key string, timeout time.Duration) (R, error) {
	return dbos.GetEvent[R](ctx, targetWorkflowID, key, timeout)
}

var (
	// GetWorkflowSteps returns one run's recorded step history, in
	// order -- the data behind the execution-visibility UI.
	GetWorkflowSteps = dbos.GetWorkflowSteps

	// ListWorkflows returns run summaries, most recent first by
	// default -- the data behind the Executions-style run list.
	ListWorkflows = dbos.ListWorkflows

	// WithStepName names a RunAsStep call -- Mill always passes the
	// executing Node's own ID.
	WithStepName = dbos.WithStepName

	// WithWorkflowID pins a run's ID instead of letting DBOS generate
	// one -- Mill always supplies its own (a fresh UUID per run).
	WithWorkflowID = dbos.WithWorkflowID

	// WithWorkflowName pins a RegisterWorkflow call's recorded name
	// instead of deriving it from the Go function's own runtime name --
	// Mill registers a bound method value, whose reflect-derived name
	// isn't a stable public contract to build crash recovery on, so
	// ExecutionService pins an explicit name instead.
	WithWorkflowName = dbos.WithWorkflowName

	// WithFilterWorkflowIDs scopes ListWorkflows to specific run IDs.
	WithFilterWorkflowIDs = dbos.WithFilterWorkflowIDs

	// WithFilterName scopes ListWorkflows to a workflow definition's
	// registered name.
	WithFilterName = dbos.WithFilterName

	// WithFilterLimit caps how many runs ListWorkflows returns.
	WithFilterLimit = dbos.WithFilterLimit

	// WithFilterSortDesc orders ListWorkflows most-recent-first.
	WithFilterSortDesc = dbos.WithFilterSortDesc

	// WithFilterParentWorkflowID scopes ListWorkflows to the children of
	// specific parent workflow ID(s) -- docs/adr/0010's child-workflow
	// tracking, verified directly against real DBOS parent/child
	// behavior (executionchildworkflow_test.go), not assumed from docs.
	WithFilterParentWorkflowID = dbos.WithFilterParentWorkflowID

	// WithFilterHasParent scopes ListWorkflows to workflows that do (or
	// don't) have a parent -- the other half of docs/adr/0010's
	// child-workflow tracking.
	WithFilterHasParent = dbos.WithFilterHasParent
)
