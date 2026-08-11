package mcpsvc

import (
	"context"
	"fmt"

	"github.com/alicoding/mill/internal/domain/guardrail"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// Debug tools (docs/adr/0031 §6): an external MCP client may drive a
// breakpoint/step-mode debug session it started -- advance one node,
// resume to completion, or stop -- but may NEVER approve a guarded
// policy ask or a human-review park (ADR-0025's resolve_approval
// exclusion stays permanent, by design). Every tool here hard-rejects
// any pending that isn't Source:debug, resolved via the same policy-
// vs-debug split ADR-0031 is built on. Sit behind the same write gate
// as the rest of the mutation/execution tier (requireWriteEnabled);
// deliberately NO per-write approval on a step advance -- a
// per-keystroke prompt would defeat stepping, and the human's consent
// is the write toggle plus the run being theirs to observe live in
// Mill's own window (the CurrentStepBar shows the exact same park).

type runWorkflowSteppedArgs struct {
	ID     string            `json:"id" jsonschema:"the workflow's ID"`
	Values map[string]string `json:"values,omitempty" jsonschema:"optional starting Attribute values, keyed by attribute key"`
}

// debugPending fetches runID's live pending approval and rejects
// anything that isn't a debug (breakpoint/step-mode) park -- the one
// check every tool below shares, so "operates ONLY on Source:debug
// parks" can't drift between them.
func (m *MillMCPService) debugPending(runID string) (nodeID string, err error) {
	if m.exec == nil {
		return "", fmt.Errorf("execution service not wired")
	}
	detail, err := m.exec.GetRun(runID)
	if err != nil {
		return "", err
	}
	if detail.Pending == nil {
		return "", fmt.Errorf("run %s is not currently parked", runID)
	}
	if detail.Pending.Source != guardrail.SourceDebug {
		return "", fmt.Errorf("run %s is paused on a policy or human-review approval, not a breakpoint/step-mode debug park -- "+
			"these debug tools only operate on Source:debug parks (resolve_approval is permanently excluded from MCP, docs/adr/0025); "+
			"a human must resolve this one in Mill's own Review queue", runID)
	}
	return detail.Pending.NodeID, nil
}

// registerDebugTools wires run_workflow_stepped/step_run/resume_run/
// stop_run. Called from registerTools alongside the export/import and
// authoring tool sets.
func (m *MillMCPService) registerDebugTools() {
	mcp.AddTool(m.server, &mcp.Tool{
		Name: "run_workflow_stepped",
		Description: "Start a workflow run in STEPPED debug mode (docs/adr/0031): it pauses before EVERY node, not just " +
			"external-effect ones, so each one's input/output can be inspected via get_run before deciding whether to " +
			"continue. Drive the resulting paused run with step_run/resume_run/stop_run. Always a test run of the draft " +
			"head. Requires the MCP-writes toggle.",
	}, func(_ context.Context, _ *mcp.CallToolRequest, in runWorkflowSteppedArgs) (*mcp.CallToolResult, any, error) {
		if err := m.requireWriteEnabled(); err != nil {
			return nil, nil, err
		}
		if m.exec == nil {
			return nil, nil, fmt.Errorf("execution service not wired")
		}
		summary, err := m.exec.RunWorkflowStepped(in.ID, in.Values)
		if err != nil {
			return nil, nil, err
		}
		emitDataChanged("run", summary.RunID)
		res, err := jsonResult(summary)
		return res, nil, err
	})

	mcp.AddTool(m.server, &mcp.Tool{
		Name: "step_run",
		Description: "Advance a paused debug run (breakpoint or stepped run) by exactly one node, then park again at the " +
			"next one -- a stepped run keeps stepping; a plain breakpoint park just resumes once. Only operates on " +
			"breakpoint/step-mode (debug) parks -- rejects a policy or human-review approval with a clear error. " +
			"Requires the MCP-writes toggle; no per-write approval prompt (a per-step prompt would defeat stepping).",
	}, func(_ context.Context, _ *mcp.CallToolRequest, in runIDArgs) (*mcp.CallToolResult, any, error) {
		if err := m.requireWriteEnabled(); err != nil {
			return nil, nil, err
		}
		nodeID, err := m.debugPending(in.RunID)
		if err != nil {
			return nil, nil, err
		}
		if err := m.exec.ResolveApproval(in.RunID, nodeID, true, nil, false); err != nil {
			return nil, nil, err
		}
		emitDataChanged("run", in.RunID)
		return textResult(fmt.Sprintf("stepped past %s -- use get_run to inspect it, or step_run/resume_run/stop_run again if it parked once more", nodeID)), nil, nil
	})

	mcp.AddTool(m.server, &mcp.Tool{
		Name: "resume_run",
		Description: "Resume a paused debug run (breakpoint or stepped run) to completion -- for a stepped run this " +
			"clears step mode so it runs straight through (any per-node breakpoints still hit independently). Only " +
			"operates on breakpoint/step-mode (debug) parks. Requires the MCP-writes toggle; no per-write approval prompt.",
	}, func(_ context.Context, _ *mcp.CallToolRequest, in runIDArgs) (*mcp.CallToolResult, any, error) {
		if err := m.requireWriteEnabled(); err != nil {
			return nil, nil, err
		}
		nodeID, err := m.debugPending(in.RunID)
		if err != nil {
			return nil, nil, err
		}
		if err := m.exec.ResolveApproval(in.RunID, nodeID, true, nil, true); err != nil {
			return nil, nil, err
		}
		emitDataChanged("run", in.RunID)
		return textResult(fmt.Sprintf("resumed past %s -- use get_run to see the final result (or the next breakpoint, if one is hit)", nodeID)), nil, nil
	})

	mcp.AddTool(m.server, &mcp.Tool{
		Name: "stop_run",
		Description: "Stop a paused debug run (breakpoint or stepped run) -- denies the pending step, failing the run " +
			"closed (docs/adr/0031's Stop control). Only operates on breakpoint/step-mode (debug) parks. Requires the " +
			"MCP-writes toggle; no per-write approval prompt.",
	}, func(_ context.Context, _ *mcp.CallToolRequest, in runIDArgs) (*mcp.CallToolResult, any, error) {
		if err := m.requireWriteEnabled(); err != nil {
			return nil, nil, err
		}
		nodeID, err := m.debugPending(in.RunID)
		if err != nil {
			return nil, nil, err
		}
		if err := m.exec.ResolveApproval(in.RunID, nodeID, false, nil, false); err != nil {
			return nil, nil, err
		}
		emitDataChanged("run", in.RunID)
		return textResult(fmt.Sprintf("stopped at %s", nodeID)), nil, nil
	})
}
