package mcpsvc

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/alicoding/mill/internal/services/compositionsvc"
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

// workflowIDArgs is the alias-resolution shape embedded by every tool
// below that identifies a workflow (goal 0021 Phase 3 gap 1: the live
// MCP probe found run_workflow/update_workflow/export_workflow/
// publish_workflow/delete_workflow all took a bare "id" while
// get_run/list_runs already used the more explicit runId/workflowId --
// pure interop friction across one entity kind, not a real design
// difference). WorkflowID is the canonical name (declared first, so it
// orders first in the generated schema); ID is kept, unchanged, as the
// original name every existing caller already sends -- both stay
// optional at the schema level so either alone validates, and resolve
// is the one place that requires at least one and decides which wins
// if a caller (mistakenly) sends both.
type workflowIDArgs struct {
	WorkflowID string `json:"workflowId,omitempty" jsonschema:"the workflow's ID (canonical name; 'id' is also accepted as a backward-compatible alias)"`
	ID         string `json:"id,omitempty" jsonschema:"alias for workflowId, kept for backward compatibility"`
}

func (a workflowIDArgs) resolve() (string, error) {
	if a.WorkflowID != "" {
		return a.WorkflowID, nil
	}
	if a.ID != "" {
		return a.ID, nil
	}
	return "", fmt.Errorf("workflowId (or its alias id) is required")
}

type updateWorkflowArgs struct {
	workflowIDArgs
	JSON string `json:"json" jsonschema:"the full workflow definition as exported-workflow JSON (same shape export_workflow returns) -- replaces the draft head; the previous draft is auto-snapshotted as a version first"`
}

type validateWorkflowArgs struct {
	JSON string `json:"json" jsonschema:"a workflow definition as exported-workflow JSON to validate without saving anything"`
}

type runWorkflowArgs struct {
	workflowIDArgs
	Values map[string]string `json:"values,omitempty" jsonschema:"optional starting Attribute values, keyed by attribute key"`
	// Payload substitutes what the workflow's trigger would have
	// delivered (a filesystem-watch trigger's changed file path) --
	// the same seam the UI Run dialog's Initial-payload field uses;
	// without it a trigger-fed workflow is untestable over MCP (goal
	// 0021 gap 1).
	Payload string `json:"payload,omitempty" jsonschema:"optional initial payload -- what the workflow's trigger would have delivered as the run's starting input (e.g. a file path for a filesystem-watch-fed workflow)"`
	// Test controls which RunKind this run is tagged (goal 0021 Phase 3
	// gap 2: the live probe found every MCP run landed "test" kind with
	// no way to opt out, silently excluded from Home's automation
	// metrics by default -- wrong for a production agent invoking a
	// real workflow). Both values execute the same DRAFT head --
	// test only changes what the run counts AS, see
	// executionsvc.RunKind.runsDraft's own doc comment.
	Test bool `json:"test,omitempty" jsonschema:"true tags this run 'test' kind (excluded from Home's automation metrics by default, same as the UI's Test-run button); false (the default) tags it a real production run, counted in Home's metrics like a genuine trigger fire. Either way this always executes the current DRAFT head, never the published version."`
}

type runIDArgs struct {
	RunID string `json:"runId" jsonschema:"a run's ID as returned by run_workflow or list_runs"`
}

// listNodeTypesArgs is list_node_types' optional discovery filter (goal
// 0052 item 6's second form: queryable discovery alongside the root
// contract document). Kind stays a plain string, not composition.NodeKind
// directly, so an invalid value reaches filterNodeTypesByKind for the
// legal-values error rather than failing opaque JSON-schema validation.
type listNodeTypesArgs struct {
	Kind string `json:"kind,omitempty" jsonschema:"optional: only step types of this kind (trigger, capture, process, apply, or decision). Omit for the full catalog."`
}

// filterableNodeKinds is the set list_node_types' kind filter accepts --
// deliberately not composition.KindTerminal: goal 0052 item 6 names the
// five composable kinds only, terminal nodes (decision-outcome) are
// reached by their decision, never composed as a filterable family of
// their own.
var filterableNodeKinds = []composition.NodeKind{
	composition.KindTrigger,
	composition.KindCapture,
	composition.KindProcess,
	composition.KindApply,
	composition.KindDecision,
}

// filterNodeTypesByKind is list_node_types' catalog-selection step and
// the root contract document's own catalog source (internal/contract's
// GenerateDocument calls composition.NodeTypes() directly for the
// unfiltered case) -- both read the identical composition.NodeTypes()
// slice, so a filtered or full result here can never diverge from what
// the document embeds. An empty kind returns the full catalog unchanged
// (today's behavior, preserved exactly).
func filterNodeTypesByKind(all []composition.NodeType, kind string) ([]composition.NodeType, error) {
	if kind == "" {
		return all, nil
	}
	valid := false
	for _, k := range filterableNodeKinds {
		if string(k) == kind {
			valid = true
			break
		}
	}
	if !valid {
		names := make([]string, len(filterableNodeKinds))
		for i, k := range filterableNodeKinds {
			names[i] = string(k)
		}
		return nil, fmt.Errorf("unknown kind %q -- legal values: %s", kind, strings.Join(names, ", "))
	}
	out := make([]composition.NodeType, 0, len(all))
	for _, nt := range all {
		if string(nt.Kind) == kind {
			out = append(out, nt)
		}
	}
	return out, nil
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
	// listStepTypes backs both tool names below -- list_step_types (the
	// primary name, docs/goals/0053 tier 2) and list_node_types (kept
	// registered as a working deprecated alias, same handler, so an
	// existing caller never breaks).
	listStepTypes := func(_ context.Context, _ *mcp.CallToolRequest, in listNodeTypesArgs) (*mcp.CallToolResult, any, error) {
		filtered, err := filterNodeTypesByKind(composition.NodeTypes(), in.Kind)
		if err != nil {
			return nil, nil, err
		}
		res, err := jsonResult(m.attributeStepTypes(filtered))
		return res, nil, err
	}
	mcp.AddTool(m.server, &mcp.Tool{
		Name:        "list_step_types",
		Description: "The step-type catalog an authored workflow composes from: ID, kind, label, description, effect class (none/read/local/external -- external steps require human approval by default), and each config field's key/type/options/reference kind. A step a plugin contributes carries source \"plugin:<pluginId>\" (see list_plugins); Mill's own steps carry no source. Optional kind filters to one kind (trigger/capture/process/apply/decision); omit for the full catalog. Read this before authoring; step type IDs and config keys must match it exactly.",
	}, listStepTypes)
	mcp.AddTool(m.server, &mcp.Tool{
		Name:        "list_node_types",
		Description: "Deprecated name of list_step_types, kept working for existing callers -- returns the identical catalog. Prefer list_step_types in new integrations.",
	}, listStepTypes)

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
		_, nodes, edges, attributes, err := compositionsvc.DecodeWorkflowGraph(in.JSON)
		if err != nil {
			res, jerr := jsonResult(validationResult{Issues: []composition.Issue{{Severity: composition.SeverityError, Message: "not parseable as exported-workflow JSON: " + err.Error()}}})
			return res, nil, jerr
		}
		resolved, err := composition.ResolveNodeDefaults(nodes)
		if err != nil {
			res, jerr := jsonResult(validationResult{Issues: []composition.Issue{{Severity: composition.SeverityError, Message: err.Error()}}})
			return res, nil, jerr
		}
		issues := composition.ValidateGraph(resolved, edges, attributes)
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
		id, err := in.resolve()
		if err != nil {
			return "", err
		}
		if _, err := m.comp.SnapshotDraft(id); err != nil {
			return "", err
		}
		wf, err := m.comp.UpdateWorkflowFromExport(id, in.JSON)
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
		id, err := in.resolve()
		if err != nil {
			return nil, nil, err
		}
		argsJSON, err := marshalArgs(in)
		if err != nil {
			return nil, nil, err
		}
		res, err := m.gateWrite("update_workflow", m.updateDiffSummary(id, in.JSON), argsJSON)
		return res, nil, err
	})

	m.registerWriteExecutor("publish_workflow", func(argsJSON string) (string, error) {
		var in workflowIDArgs
		if err := json.Unmarshal([]byte(argsJSON), &in); err != nil {
			return "", err
		}
		id, err := in.resolve()
		if err != nil {
			return "", err
		}
		wf, err := m.comp.PublishWorkflow(id)
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
	}, func(_ context.Context, _ *mcp.CallToolRequest, in workflowIDArgs) (*mcp.CallToolResult, any, error) {
		if err := m.requireWriteEnabled(); err != nil {
			return nil, nil, err
		}
		id, err := in.resolve()
		if err != nil {
			return nil, nil, err
		}
		argsJSON, err := marshalArgs(in)
		if err != nil {
			return nil, nil, err
		}
		res, err := m.gateWrite("publish_workflow", "An MCP client wants to PUBLISH workflow "+m.workflowLabel(id)+" (its draft becomes the live version)", argsJSON)
		return res, nil, err
	})

	m.registerWriteExecutor("delete_workflow", func(argsJSON string) (string, error) {
		var in workflowIDArgs
		if err := json.Unmarshal([]byte(argsJSON), &in); err != nil {
			return "", err
		}
		id, err := in.resolve()
		if err != nil {
			return "", err
		}
		if err := m.comp.DeleteWorkflow(id); err != nil {
			return "", err
		}
		// DeleteWorkflow (compositionsvc) already emits "workflow" -- see
		// the update_workflow executor's comment above.
		return "deleted", nil
	})
	mcp.AddTool(m.server, &mcp.Tool{
		Name:        "delete_workflow",
		Description: "Delete a workflow entirely (definition, versions, hotkey binding). Requires the MCP-writes toggle + per-write approval; may park pending approval -- see import_workflow's description for the poll contract.",
	}, func(_ context.Context, _ *mcp.CallToolRequest, in workflowIDArgs) (*mcp.CallToolResult, any, error) {
		if err := m.requireWriteEnabled(); err != nil {
			return nil, nil, err
		}
		id, err := in.resolve()
		if err != nil {
			return nil, nil, err
		}
		argsJSON, err := marshalArgs(in)
		if err != nil {
			return nil, nil, err
		}
		res, err := m.gateWrite("delete_workflow", "An MCP client wants to DELETE workflow "+m.workflowLabel(id), argsJSON)
		return res, nil, err
	})

	// --- Execution: behind the write gate (MCP may act on this
	//     instance at all); the guardrail engine is the approval layer
	//     for the run itself -- external-effect steps park in the
	//     human's Review queue no matter who started the run. ---
	mcp.AddTool(m.server, &mcp.Tool{
		Name: "run_workflow",
		Description: "Run a workflow, executing the current DRAFT head (same as the UI's Run button). Default " +
			"(test:false) tags the run a REAL production run, counted in Home's automation metrics like a genuine " +
			"trigger fire; test:true tags it 'test' kind instead (excluded from Home's metrics by default, same as " +
			"a manual authoring/debug click) -- either way the executed graph is identical. External-effect steps " +
			"(HTTP, MCP tool calls) pause in the human's Review queue for approval; the run may return " +
			"still-pending. Use get_run to inspect the result. Requires the MCP-writes toggle.",
	}, func(_ context.Context, _ *mcp.CallToolRequest, in runWorkflowArgs) (*mcp.CallToolResult, any, error) {
		if err := m.requireWriteEnabled(); err != nil {
			return nil, nil, err
		}
		id, err := in.resolve()
		if err != nil {
			return nil, nil, err
		}
		if m.exec == nil {
			return nil, nil, fmt.Errorf("execution service not wired")
		}
		kind := executionsvc.RunKindMCP
		if in.Test {
			kind = executionsvc.RunKindTest
		}
		summary, err := m.exec.RunWorkflowWithPayload(id, kind, in.Values, in.Payload)
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
// definition, nextNodes/nextEdges stay nil, which would otherwise
// render as a fabricated "steps 3→0, edges 2→0" -- reading as "this
// deletes everything" to the approver when the real problem is just
// that the document didn't parse. docs/goals/0025 item 4: say so
// honestly instead (the actual gateWrite call still happens either way
// -- the real json.Unmarshal inside UpdateWorkflow itself is what
// actually rejects the malformed document, this is only the preview
// text).
func (m *MillMCPService) updateDiffSummary(id, jsonData string) string {
	nextLabel, nextNodes, nextEdges, _, err := compositionsvc.DecodeWorkflowGraph(jsonData)
	if err != nil {
		for _, wf := range m.comp.Workflows() {
			if wf.ID == id {
				return fmt.Sprintf("An MCP client wants to UPDATE workflow %q (unable to parse proposed definition)", wf.Label)
			}
		}
		return "An MCP client wants to UPDATE workflow " + id + " (unable to parse proposed definition)"
	}
	for _, wf := range m.comp.Workflows() {
		if wf.ID == id {
			s := fmt.Sprintf("An MCP client wants to UPDATE workflow %q: steps %d→%d, edges %d→%d",
				wf.Label, len(wf.Nodes), len(nextNodes), len(wf.Edges), len(nextEdges))
			if nextLabel != "" && nextLabel != wf.Label {
				s += fmt.Sprintf(", rename to %q", nextLabel)
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
