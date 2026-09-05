package executionsvc

import (
	"fmt"
	"strings"

	"github.com/alicoding/mill/internal/domain/composition"
)

// This file owns the run ENTRY surface: the options a caller may
// supply, the pre-flight refusal every entry point shares, and the
// exported RPCs themselves. Split from executionservice.go at the
// 500-line convention (.claude/rules/architecture.md).

// RunOptions bundles runWorkflowStart's optional inputs (goal 0306 S5)
// -- the same "one struct once two independent optionals exist" move
// composition.ExecuteOptions already made, applied here before an
// eighth positional argument made the call sites unreadable.
type RunOptions struct {
	// Values overrides the run's starting Attribute values, keyed by
	// AttributeDef.Key (docs/adr/0008's test-input form).
	Values map[string]string
	// Payload seeds the run's starting ExecContext.Payload.
	Payload string
	// Stepped starts the run in debug step mode (docs/adr/0031 §5).
	Stepped bool
	// AtlasSourceCardID names the card whose write started this run.
	AtlasSourceCardID string
	// SecretsToken correlates this run to codeloopsvc's typed-secrets
	// stash (goal 0240 S2).
	SecretsToken string
	// EnvironmentID picks this run's Environment. EnvironmentSet is
	// what tells "the caller chose none" apart from "the caller did not
	// choose": only the first may override a workflow's own default,
	// and every entry point that has nobody to ask (a schedule, a
	// trigger, a child call) leaves both zero and inherits the default.
	EnvironmentID  string
	EnvironmentSet bool
}

// environmentFor resolves which Environment a run executes in: the
// caller's explicit choice when it made one, the workflow's own
// default otherwise.
func (o RunOptions) environmentFor(wf composition.Workflow) string {
	if o.EnvironmentSet {
		return o.EnvironmentID
	}
	return wf.DefaultEnvironmentID
}

// preflightRefusal refuses to start a run validation already knows
// will fail: error-severity issues, or a warning marked WillFail (an
// unset required reference). Refusing here with the issue's own
// message beats letting the run start and fail mid-flight with a step
// error (goal 0127). Saving such a draft stays legal (ADR-0028's
// warn-don't-block); only running is refused.
func preflightRefusal(nodes []composition.Node, edges []composition.Edge, attrs []composition.AttributeDef, environmentID string) error {
	var blocking []string
	issues := composition.ValidateGraph(nodes, edges, attrs)
	// Environment-dependent (goal 0306 S5): which {{var}} a step can
	// resolve depends on the environment THIS run picked, which
	// ValidateGraph deliberately does not know.
	issues = append(issues, composition.ValidateEnvironmentVars(nodes, environmentID)...)
	for _, issue := range issues {
		if issue.Severity == composition.SeverityError || issue.WillFail {
			blocking = append(blocking, issue.Message)
		}
	}
	if len(blocking) > 0 {
		return fmt.Errorf("this workflow can't run yet: %s", strings.Join(blocking, "; "))
	}
	return nil
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
// Delegates to RunWorkflowWithPayload with an empty starting payload --
// every existing caller of this method (Composition's canvas Run
// button, the MCP authoring loop's run_workflow tool) behaves exactly
// as before this field existed.
func (e *ExecutionService) RunWorkflow(workflowID string, kind RunKind, values map[string]string) (RunSummary, error) {
	return e.runWorkflowStart(workflowID, kind, RunOptions{Values: values})
}

// RunWorkflowWithPayload is RunWorkflow plus a starting payload for the
// root ExecContext (docs/SPEC.md §3.4's Trigger row: "a trigger's
// output IS the workflow's input") -- TriggerService's headless fire
// path uses this to thread a real trigger event's own data (e.g. a
// filesystem-watch trigger's changed file path) into the run instead of
// starting from "".
func (e *ExecutionService) RunWorkflowWithPayload(workflowID string, kind RunKind, values map[string]string, payload string) (RunSummary, error) {
	return e.runWorkflowStart(workflowID, kind, RunOptions{Values: values, Payload: payload})
}

// RunWorkflowWithSecretsToken is RunWorkflowWithPayload plus a
// codeloopsvc typed-secrets correlation token (goal 0240 S2) --
// codeloopsvc.RunCommandBlock is this method's only caller: it stashes
// any typed-at-Confirm secret VALUES under secretsToken (in memory,
// never persisted) before calling this, so by the time the run's own
// process-shell-command step needs them, the stash is already there
// regardless of how quickly the guardrail gate lets the run proceed.
// Every other caller of RunWorkflowWithPayload is unaffected -- this is
// an additive method, not a signature change to the existing one.
//
//wails:ignore
func (e *ExecutionService) RunWorkflowWithSecretsToken(workflowID string, kind RunKind, values map[string]string, payload, secretsToken string) (RunSummary, error) {
	return e.runWorkflowStart(workflowID, kind, RunOptions{Values: values, Payload: payload, SecretsToken: secretsToken})
}

// RunWorkflowInEnvironment is RunWorkflowWithPayload plus an explicit
// Environment for this one run (goal 0306 S5), overriding the
// workflow's own default -- the Run dialog's own entry point, and the
// only one that can say "none" and mean it rather than "no opinion."
func (e *ExecutionService) RunWorkflowInEnvironment(workflowID string, kind RunKind, values map[string]string, payload, environmentID string) (RunSummary, error) {
	return e.runWorkflowStart(workflowID, kind, RunOptions{Values: values, Payload: payload, EnvironmentID: environmentID, EnvironmentSet: true})
}

// RunWorkflowStepped starts a workflow run in debug "step mode"
// (docs/adr/0031 §5) -- a run-scoped debug variant of the normal Run
// action, always a test run of the draft head (matching ADR-0008's
// test-input dialog, never the published snapshot): the guardrail gate
// parks before EVERY node, not just external-effect ones, until a
// "Continue" resume clears it (executionservice_guardrail.go). Always
// starts non-blocking (the run is guaranteed to park at its first node)
// regardless of mayRequireApproval's own pre-scan.
// payload seeds the run's starting ExecContext.Payload, exactly like
// RunWorkflowWithPayload -- a stepped test run of a workflow whose
// trigger normally supplies the input (a filesystem-watch path) needs
// the same substitute input a plain test run does.
func (e *ExecutionService) RunWorkflowStepped(workflowID string, values map[string]string, payload string) (RunSummary, error) {
	return e.runWorkflowStart(workflowID, RunKindTest, RunOptions{Values: values, Payload: payload, Stepped: true})
}
