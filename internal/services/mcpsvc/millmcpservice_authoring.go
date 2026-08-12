package mcpsvc

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/alicoding/mill/internal/services/dataevent"
	"github.com/alicoding/mill/internal/services/executionsvc"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// The LLM-authoring tool tier (docs/adr/0025): an external MCP client
// (an LLM host like Claude Code) introspects, validates, mutates, and
// runs Mill workflows over the same export/import JSON the UI's own
// buttons use -- one document format, one protocol. Mill stays an MCP
// SERVER throughout (§1.1: never itself an LLM client). Tier gating:
// introspection/validation are read-only/pure and ungated; mutation
// rides the existing write gate + per-write approval with a diff
// summary; execution rides the write gate, with the guardrail engine
// (docs/adr/0022) as its own approval layer -- external-effect steps
// park in the human's Review queue regardless of who started the run.
// resolve_approval is PERMANENTLY EXCLUDED by design, not omission: an
// LLM approving its own guarded runs would collapse the guardrail.

// SetExecutionService late-binds the execution service for the
// list_runs/get_run/run_workflow tools -- same late-bound-setter shape
// as SettingsService.SetMCPService, for the same construction-order
// reason. mcpsvc is not a Wails-bound service, so no //wails:ignore is
// needed.
func (m *MillMCPService) SetExecutionService(e *executionsvc.ExecutionService) { m.exec = e }

type idArgs struct {
	ID string `json:"id" jsonschema:"the entity's ID"`
}

type updateWorkflowArgs struct {
	ID   string `json:"id" jsonschema:"the workflow's ID (list mill://workflows to discover)"`
	JSON string `json:"json" jsonschema:"the full workflow definition as exported-workflow JSON (same shape export_workflow returns) -- replaces the draft head; the previous draft is auto-snapshotted as a version first"`
}

type validateWorkflowArgs struct {
	JSON string `json:"json" jsonschema:"a workflow definition as exported-workflow JSON to validate without saving anything"`
}

type runWorkflowArgs struct {
	ID     string            `json:"id" jsonschema:"the workflow's ID"`
	Values map[string]string `json:"values,omitempty" jsonschema:"optional starting Attribute values, keyed by attribute key"`
	// Payload substitutes what the workflow's trigger would have
	// delivered (a filesystem-watch trigger's changed file path) --
	// the same seam the UI Run dialog's Initial-payload field uses;
	// without it a trigger-fed workflow is untestable over MCP (goal
	// 0021 gap 1, found live-probing the capture-floor seed).
	Payload string `json:"payload,omitempty" jsonschema:"optional initial payload -- what the workflow's trigger would have delivered as the run's starting input (e.g. a file path for a filesystem-watch-fed workflow)"`
}

type runIDArgs struct {
	RunID string `json:"runId" jsonschema:"a run's ID as returned by run_workflow or list_runs"`
}

func jsonResult(v any) (*mcp.CallToolResult, error) {
	text, err := jsonText(v)
	if err != nil {
		return nil, err
	}
	return textResult(text), nil
}

// validationResult is validate_workflow's own wire shape (docs/adr/0028)
// -- lowercase field names, deliberately distinct from the PascalCase
// domain-struct convention every other Wails-bound RPC uses, since this
// is an ad hoc MCP tool response, not a generated binding.
type validationResult struct {
	Valid  bool                `json:"valid"`
	Issues []composition.Issue `json:"issues"`
}

// hasErrorIssue reports whether issues contains at least one
// Error-severity entry -- the same rollup ValidateGraphStrict does
// internally, exposed here since validate_workflow needs the boolean
// answer alongside the full list, not the joined-error-string form.
func hasErrorIssue(issues []composition.Issue) bool {
	for _, i := range issues {
		if i.Severity == composition.SeverityError {
			return true
		}
	}
	return false
}

// registerAuthoringTools wires the introspect/validate/mutate/run tier.
// Called from registerTools alongside the export/import set.
func (m *MillMCPService) registerAuthoringTools() {
	// --- Introspection: read-only, ungated. ---
	mcp.AddTool(m.server, &mcp.Tool{
		Name:        "list_node_types",
		Description: "The full node-type catalog an authored workflow composes from: ID, kind, label, description, effect class (none/read/local/external -- external steps require human approval by default), and each config field's key/type/options/reference kind. Read this before authoring; node type IDs and config keys must match it exactly.",
	}, func(_ context.Context, _ *mcp.CallToolRequest, _ struct{}) (*mcp.CallToolResult, any, error) {
		res, err := jsonResult(composition.NodeTypes())
		return res, nil, err
	})

	mcp.AddTool(m.server, &mcp.Tool{
		Name:        "list_runs",
		Description: "Recent run history (durable, all workflows or one workflow when id is given): status, kind, output, pending-approval state. The inspect half of the author-run-inspect loop.",
	}, func(_ context.Context, _ *mcp.CallToolRequest, in struct {
		WorkflowID string `json:"workflowId,omitempty" jsonschema:"optional: only this workflow's runs"`
	}) (*mcp.CallToolResult, any, error) {
		if m.exec == nil {
			return nil, nil, fmt.Errorf("execution service not wired")
		}
		var (
			runs []executionsvc.RunSummary
			err  error
		)
		if in.WorkflowID == "" {
			runs, err = m.exec.ListRuns()
		} else {
			runs, err = m.exec.ListRunsForWorkflow(in.WorkflowID)
		}
		if err != nil {
			return nil, nil, err
		}
		res, err := jsonResult(runs)
		return res, nil, err
	})

	mcp.AddTool(m.server, &mcp.Tool{
		Name:        "get_run",
		Description: "One run's full per-step breakdown: each step's status, output, error, and recorded guardrail verdict. Use after run_workflow to see exactly what happened.",
	}, func(_ context.Context, _ *mcp.CallToolRequest, in runIDArgs) (*mcp.CallToolResult, any, error) {
		if m.exec == nil {
			return nil, nil, fmt.Errorf("execution service not wired")
		}
		detail, err := m.exec.GetRun(in.RunID)
		if err != nil {
			return nil, nil, err
		}
		res, err := jsonResult(detail)
		return res, nil, err
	})

	// --- Validation: pure, saves nothing, ungated. ---
	mcp.AddTool(m.server, &mcp.Tool{
		Name:        "validate_workflow",
		Description: "Validate a workflow definition (exported-workflow JSON) without saving. Returns the FULL issue list (docs/adr/0028), not just the first problem: every graph rule Mill checks (trigger root, reachability, Decision edge conditions, secret-output guardrail, dangling Capture/Process leaves, unset entity references), each labeled 'error' or 'warning'. 'valid' is true iff no error-severity issue is present -- warnings never block update_workflow, they're informational only. Iterate here before update_workflow.",
	}, func(_ context.Context, _ *mcp.CallToolRequest, in validateWorkflowArgs) (*mcp.CallToolResult, any, error) {
		var def struct {
			Label      string                     `json:"label"`
			Nodes      []composition.Node         `json:"nodes"`
			Edges      []composition.Edge         `json:"edges"`
			Attributes []composition.AttributeDef `json:"attributes"`
		}
		if err := json.Unmarshal([]byte(in.JSON), &def); err != nil {
			res, jerr := jsonResult(validationResult{Issues: []composition.Issue{{Severity: composition.SeverityError, Message: "not parseable as exported-workflow JSON: " + err.Error()}}})
			return res, nil, jerr
		}
		resolved, err := composition.ResolveNodeDefaults(def.Nodes)
		if err != nil {
			res, jerr := jsonResult(validationResult{Issues: []composition.Issue{{Severity: composition.SeverityError, Message: err.Error()}}})
			return res, nil, jerr
		}
		issues := composition.ValidateGraph(resolved, def.Edges, def.Attributes)
		res, jerr := jsonResult(validationResult{Valid: !hasErrorIssue(issues), Issues: issues})
		return res, nil, jerr
	})

	// --- Mutation: write gate + per-write approval (docs/adr/0032's
	//     park-and-poll gateWrite) with a diff summary. The previous
	//     draft is ALWAYS snapshotted first (revertible via the Versions
	//     tab / RestoreVersionToDraft). ---
	m.registerWriteExecutor("update_workflow", func(argsJSON string) (string, error) {
		var in updateWorkflowArgs
		if err := json.Unmarshal([]byte(argsJSON), &in); err != nil {
			return "", err
		}
		if _, err := m.comp.SnapshotDraft(in.ID); err != nil {
			return "", err
		}
		wf, err := m.comp.UpdateWorkflowFromExport(in.ID, in.JSON)
		if err != nil {
			return "", err
		}
		// No manual dataevent.Emit here -- SnapshotDraft/UpdateWorkflow/
		// UpdateAttributes (compositionsvc) already emit "workflow"
		// internally now (goal 0017), so an MCP-driven update_workflow
		// still lands the exact same live-sync event it always did.
		return fmt.Sprintf("updated draft of %q (previous draft snapshotted as v%d)", wf.Label, len(wf.Versions)), nil
	})
	mcp.AddTool(m.server, &mcp.Tool{
		Name:        "update_workflow",
		Description: "Replace a workflow's DRAFT definition with exported-workflow JSON. The current draft is auto-snapshotted as a version first, so the change is always revertible from the workflow's Versions tab. Never touches the published version (publish_workflow is the separate go-live act). Requires the MCP-writes toggle; each write asks the human in Mill's window unless they relaxed per-write approval, and may park pending approval -- see import_workflow's description for the poll contract.",
	}, func(_ context.Context, _ *mcp.CallToolRequest, in updateWorkflowArgs) (*mcp.CallToolResult, any, error) {
		if err := m.requireWriteEnabled(); err != nil {
			return nil, nil, err
		}
		argsJSON, err := marshalArgs(in)
		if err != nil {
			return nil, nil, err
		}
		res, err := m.gateWrite("update_workflow", m.updateDiffSummary(in.ID, in.JSON), argsJSON)
		return res, nil, err
	})

	m.registerWriteExecutor("publish_workflow", func(argsJSON string) (string, error) {
		var in idArgs
		if err := json.Unmarshal([]byte(argsJSON), &in); err != nil {
			return "", err
		}
		wf, err := m.comp.PublishWorkflow(in.ID)
		if err != nil {
			return "", err
		}
		// PublishWorkflow (compositionsvc, via mutateWorkflow) already
		// emits "workflow" -- see the update_workflow executor's comment
		// above.
		return fmt.Sprintf("published %q as v%d (live)", wf.Label, wf.PublishedVersion), nil
	})
	mcp.AddTool(m.server, &mcp.Tool{
		Name:        "publish_workflow",
		Description: "Publish a workflow's current draft as the new live version (docs/adr/0021: triggers and child calls execute only the published snapshot). Requires the MCP-writes toggle + per-write approval; may park pending approval -- see import_workflow's description for the poll contract.",
	}, func(_ context.Context, _ *mcp.CallToolRequest, in idArgs) (*mcp.CallToolResult, any, error) {
		if err := m.requireWriteEnabled(); err != nil {
			return nil, nil, err
		}
		argsJSON, err := marshalArgs(in)
		if err != nil {
			return nil, nil, err
		}
		res, err := m.gateWrite("publish_workflow", "An MCP client wants to PUBLISH workflow "+m.workflowLabel(in.ID)+" (its draft becomes the live version)", argsJSON)
		return res, nil, err
	})

	m.registerWriteExecutor("delete_workflow", func(argsJSON string) (string, error) {
		var in idArgs
		if err := json.Unmarshal([]byte(argsJSON), &in); err != nil {
			return "", err
		}
		if err := m.comp.DeleteWorkflow(in.ID); err != nil {
			return "", err
		}
		// DeleteWorkflow (compositionsvc) already emits "workflow" -- see
		// the update_workflow executor's comment above.
		return "deleted", nil
	})
	mcp.AddTool(m.server, &mcp.Tool{
		Name:        "delete_workflow",
		Description: "Delete a workflow entirely (definition, versions, hotkey binding). Requires the MCP-writes toggle + per-write approval; may park pending approval -- see import_workflow's description for the poll contract.",
	}, func(_ context.Context, _ *mcp.CallToolRequest, in idArgs) (*mcp.CallToolResult, any, error) {
		if err := m.requireWriteEnabled(); err != nil {
			return nil, nil, err
		}
		argsJSON, err := marshalArgs(in)
		if err != nil {
			return nil, nil, err
		}
		res, err := m.gateWrite("delete_workflow", "An MCP client wants to DELETE workflow "+m.workflowLabel(in.ID), argsJSON)
		return res, nil, err
	})

	// --- Execution: behind the write gate (MCP may act on this
	//     instance at all); the guardrail engine is the approval layer
	//     for the run itself -- external-effect steps park in the
	//     human's Review queue no matter who started the run. ---
	mcp.AddTool(m.server, &mcp.Tool{
		Name:        "run_workflow",
		Description: "Run a workflow (test kind -- executes the draft head, same as the UI's Run button). External-effect steps (HTTP, MCP tool calls) pause in the human's Review queue for approval; the run may return still-pending. Use get_run to inspect the result. Requires the MCP-writes toggle.",
	}, func(_ context.Context, _ *mcp.CallToolRequest, in runWorkflowArgs) (*mcp.CallToolResult, any, error) {
		if err := m.requireWriteEnabled(); err != nil {
			return nil, nil, err
		}
		if m.exec == nil {
			return nil, nil, fmt.Errorf("execution service not wired")
		}
		summary, err := m.exec.RunWorkflowWithPayload(in.ID, executionsvc.RunKindTest, in.Values, in.Payload)
		if err != nil {
			return nil, nil, err
		}
		dataevent.Emit("run", summary.RunID)
		res, err := jsonResult(summary)
		return res, nil, err
	})
}

// updateDiffSummary renders the approval banner's what-changes preview
// for an update_workflow ask -- the PreToolUse-style preview applied to
// authoring (docs/adr/0025): the human sees the shape of the change,
// not just that "something" wants to write. On a malformed proposed
// definition, next stays the zero value, which would otherwise render
// as a fabricated "nodes 3→0, edges 2→0" -- reading as "this deletes
// everything" to the approver when the real problem is just that the
// document didn't parse. docs/goals/0025 item 4: say so honestly
// instead (the actual gateWrite call still happens either way -- the
// real json.Unmarshal inside UpdateWorkflow itself is what actually
// rejects the malformed document, this is only the preview text).
func (m *MillMCPService) updateDiffSummary(id, jsonData string) string {
	var next struct {
		Label string             `json:"label"`
		Nodes []composition.Node `json:"nodes"`
		Edges []composition.Edge `json:"edges"`
	}
	if err := json.Unmarshal([]byte(jsonData), &next); err != nil {
		for _, wf := range m.comp.Workflows() {
			if wf.ID == id {
				return fmt.Sprintf("An MCP client wants to UPDATE workflow %q (unable to parse proposed definition)", wf.Label)
			}
		}
		return "An MCP client wants to UPDATE workflow " + id + " (unable to parse proposed definition)"
	}
	for _, wf := range m.comp.Workflows() {
		if wf.ID == id {
			s := fmt.Sprintf("An MCP client wants to UPDATE workflow %q: nodes %d→%d, edges %d→%d",
				wf.Label, len(wf.Nodes), len(next.Nodes), len(wf.Edges), len(next.Edges))
			if next.Label != "" && next.Label != wf.Label {
				s += fmt.Sprintf(", rename to %q", next.Label)
			}
			return s + " (previous draft is snapshotted first)"
		}
	}
	return "An MCP client wants to UPDATE workflow " + id
}

func (m *MillMCPService) workflowLabel(id string) string {
	for _, wf := range m.comp.Workflows() {
		if wf.ID == id {
			return fmt.Sprintf("%q", wf.Label)
		}
	}
	return id
}
