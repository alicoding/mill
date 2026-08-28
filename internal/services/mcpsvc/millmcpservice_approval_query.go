package mcpsvc

import (
	"encoding/json"
	"sort"

	"github.com/alicoding/mill/internal/adapters/mcpaudit"
	"github.com/alicoding/mill/internal/adapters/windowing"
	"github.com/alicoding/mill/internal/services/guardrailsvc"
)

// The read/query half of the park-and-poll approval lifecycle
// (millmcpservice_approval.go): the Activity-event shape + emit
// helpers, and every read-only surface
// (PendingMCPWrites/ResolvedMCPWrites/check_write_status) -- split out
// once the lifecycle file crossed the 500-line limit (CLAUDE.md/§1.3),
// the same "split along a real seam" discipline this codebase already
// applies elsewhere. gateWrite/ResolveMCPWrite/CancelMCPWrite stay in
// millmcpservice_approval.go; the lazy expiry sweep itself now lives in
// the shared guardrailsvc.PendingActionStore (docs/adr/0047 §5.4's
// follow-up) -- everything here either reports what that store's sweep
// just found (emitExpired) or reads the store without mutating a
// pending decision.

// MCPWriteActivity is pushed for a resolved (denied/cancelled/expired,
// or approved-but-failed) MCP write so it's no longer traceless
// (docs/goals/0005-pending-attention-model.md item 3). Reuses the same
// activity-push shape App.tsx's hotkey-activity handler already
// established, under a distinct "mcp-write" ActivitySource so it's
// filterable, not conflated with a workflow trigger.
type MCPWriteActivity struct {
	Description string `json:"description"`
	// Outcome is "denied", "cancelled", or "expired" -- an
	// approved-and-succeeded write never reaches here, there's nothing
	// traceless about it.
	Outcome string `json:"outcome"`
	// ToolName/WorkflowID/Result back Activity's own MCP-write row
	// actions (docs/goals/0026 item 7: "so what I can do and nothing I
	// can do") -- ToolName is the gated tool this record was for;
	// WorkflowID is the workflow it targeted, when the tool names one
	// (update_workflow/publish_workflow/delete_workflow's own "id"
	// argument -- empty for import_* tools, which mint a NEW entity
	// rather than referencing an existing one, so there's nothing to
	// jump to); Result is what the Activity row's expandable detail
	// panel shows.
	ToolName   string `json:"toolName,omitempty"`
	WorkflowID string `json:"workflowID,omitempty"`
	Result     string `json:"result,omitempty"`
}

// targetWorkflowID extracts the workflow a mutation tool's own args
// named, when it names one at all -- update_workflow/publish_workflow/
// delete_workflow all embed workflowIDArgs (millmcpservice_authoring.go),
// so either the canonical "workflowId" or the legacy "id" alias
// resolves the same way a live call would; import_* tools have no
// existing target (they mint a new ID), so this deliberately returns ""
// for anything else rather than guessing.
func targetWorkflowID(toolName, argsJSON string) string {
	switch toolName {
	case "update_workflow", "publish_workflow", "delete_workflow":
	default:
		return ""
	}
	var in workflowIDArgs
	if err := json.Unmarshal([]byte(argsJSON), &in); err != nil {
		return ""
	}
	id, _ := in.resolve()
	return id
}

// emitMCPWriteActivity pushes MCPWriteActivity to the frontend.
// application.Get() is nil in a headless Go test process -- a no-op
// there, same guard executionservice_guardrail.go's
// emitGuardrailPendingChanged uses.
func emitMCPWriteActivity(description, outcome, toolName, argsJSON, result string) {
	windowing.Emit("mcp-write-activity", MCPWriteActivity{
		Description: description,
		Outcome:     outcome,
		ToolName:    toolName,
		WorkflowID:  targetWorkflowID(toolName, argsJSON),
		Result:      result,
	})
}

// emitMCPWriteApprovalChanged pings the SAME event a new park already
// emits (docs/goals/0026 item 5, BUG fix) -- every surface that shows a
// pending-MCP-write count (the sidebar badge, ReviewView,
// MCPWriteApprovals, ApprovalPrompt) already listens for
// 'mcp-write-approval' and unconditionally refetches on receipt (goal
// 0005's "one signal, many refresh calls" model) -- so a resolution
// path only needs to fire the SAME event, never a second channel.
//
// Emits a zero-value MCPWriteRequest, NOT an empty struct{} -- found
// live, not assumed: main.go's application.RegisterEvent[MCPWriteRequest]
// ("mcp-write-approval") documents that Wails3 "matches data types
// exactly and no conversion is performed," so a struct{}{} payload
// silently failed this event's own type check and was dropped before
// ever reaching a browser client. Every listener still ignores
// evt.data and just refetches; this only has to satisfy the registered
// type, not carry real content.
func emitMCPWriteApprovalChanged() {
	windowing.Emit("mcp-write-approval", MCPWriteRequest{})
}

// emitExpired pushes an Activity row for every record the shared
// store's own lazy sweep just expired, and pings the pending-changed
// signal exactly once if anything expired, so the sidebar badge/queue
// counts drop even when nobody happened to call
// ResolveMCPWrite/CancelMCPWrite around the same sweep. Only reports
// records whose Kind is this package's own guardrail kind -- the shared
// store may one day carry other callers' pending actions too (docs/adr/
// 0047 §5.4), and this package's Activity feed is MCP-write-specific.
func (m *MillMCPService) emitExpired(expired []guardrailsvc.GuardedActionRecord) {
	any := false
	for _, e := range expired {
		if e.Kind != mcpWriteGuardrailKind {
			continue
		}
		any = true
		toolName := ""
		if p, ok := decodeMCPWritePayload(e.Payload); ok {
			toolName = p.ToolName
		}
		emitMCPWriteActivity(e.Description, string(MCPWriteStatusExpired), toolName, argsJSONFromPayload(e.Payload), e.Error)
		// Goal 0159 slice 1: the third async Parked* transition (the
		// other two are ResolveMCPWrite/CancelMCPWrite) -- a write nobody
		// ever decided on, aged out by the clock rather than a human.
		if m.auditResolver != nil {
			m.auditResolver(e.ID, mcpaudit.OutcomeParkedExpired, e.Error)
		}
	}
	if any {
		emitMCPWriteApprovalChanged()
	}
}

// PendingMCPWrites lists writes currently awaiting a human decision,
// oldest first -- sweeps lazily first (via the shared store) so a
// since-expired record never shows up as still pending.
func (m *MillMCPService) PendingMCPWrites() []MCPWriteRequest {
	records, expired := m.parkStore.Pending(mcpWriteGuardrailKind, mcpWriteExpiry)
	m.emitExpired(expired)

	out := make([]MCPWriteRequest, 0, len(records))
	for _, rec := range records {
		out = append(out, MCPWriteRequest{ID: rec.ID, Description: rec.Description, CreatedAt: rec.CreatedAt, LastPolledAt: rec.LastPolledAt})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt.Before(out[j].CreatedAt) })
	return out
}

// ResolvedMCPWrites lists every already-resolved write still in the
// retention window (docs/goals/0026 item 6) -- newest-resolved first,
// the same "queue's own history must include write resolutions"
// Review's Recently-resolved section merges alongside RunSummary's own
// resolved runs. Sweeps lazily first, same as every other read here.
func (m *MillMCPService) ResolvedMCPWrites() []MCPWriteResolved {
	records, expired := m.parkStore.Resolved(mcpWriteGuardrailKind, mcpWriteExpiry)
	m.emitExpired(expired)

	out := make([]MCPWriteResolved, 0, len(records))
	for _, rec := range records {
		out = append(out, MCPWriteResolved{
			ID: rec.ID, Description: rec.Description, Status: string(mcpStatusFrom(rec.Status)),
			Error: rec.Error, CreatedAt: rec.CreatedAt, ResolvedAt: *rec.ResolvedAt,
		})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ResolvedAt.After(out[j].ResolvedAt) })
	return out
}

// checkWriteStatusArgs/Result back the check_write_status tool
// (registered in millmcpservice_tools.go's registerTools).
type checkWriteStatusArgs struct {
	ID string `json:"id" jsonschema:"the pending write's id, from a gated write tool's 'parked pending human approval' response text"`
}

type checkWriteStatusResult struct {
	Status      string `json:"status"`
	Description string `json:"description,omitempty"`
	Result      string `json:"result,omitempty"`
	Error       string `json:"error,omitempty"`
}

// DebugBackdatePendingWrite is an e2e-only test knob (docs/goals/0026
// item 2's staleness presentation: "inject via an internal test knob or
// backdate CreatedAt through the store fixture"). Editing the settings
// file directly from outside a running server doesn't work here -- the
// server only ever loads its pending-action store once at startup and
// treats it as the live source of truth from then on, so an external
// file edit would simply be overwritten by the next persist -- this is
// the in-process equivalent, shifting an already-parked record's
// CreatedAt back so a real 15m/24h age-tier render can be exercised
// without sleeping real minutes/hours. Gated by the caller
// (SettingsService.DebugBackdatePendingMCPWrite) to isolated test data
// only -- never reachable against a real production instance.
func (m *MillMCPService) DebugBackdatePendingWrite(id string, ageMinutes int) error {
	if err := m.parkStore.Backdate(id, ageMinutes); err != nil {
		return err
	}
	// Every poll-less surface (the banner, the floating approval prompt)
	// only refreshes on this event -- without it, a backdated write
	// would render stale until something else happened to trigger a
	// refetch (ReviewView's own 2s poll would mask that, same class of
	// masking item 5's bug fix already caught once).
	emitMCPWriteApprovalChanged()
	return nil
}

// writeStatus sweeps lazily, then returns a snapshot of rec's outcome
// fields -- used by check_write_status. Also records LastPolledAt
// (docs/goals/0026 item 3) -- check_write_status IS the requester's own
// heartbeat, so every real poll (a hit, not a miss) updates it and
// persists, same as every other lifecycle mutation in this file.
func (m *MillMCPService) writeStatus(id string) (checkWriteStatusResult, bool) {
	rec, ok, expired := m.parkStore.Poll(id, mcpWriteExpiry)
	m.emitExpired(expired)
	if !ok {
		return checkWriteStatusResult{}, false
	}
	return checkWriteStatusResult{
		Status: string(mcpStatusFrom(rec.Status)), Description: rec.Description, Result: rec.ResultText, Error: rec.Error,
	}, true
}
