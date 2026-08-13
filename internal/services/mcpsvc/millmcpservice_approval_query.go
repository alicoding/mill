package mcpsvc

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"sort"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// The read/query half of the park-and-poll lifecycle
// (millmcpservice_approval.go): the Activity-event shape + emit
// helpers, the lazy expiry sweep, and every read-only surface
// (PendingMCPWrites/ResolvedMCPWrites/check_write_status) -- split out
// once the lifecycle file crossed the 500-line limit (CLAUDE.md/§1.3),
// the same "split along a real seam" discipline this codebase already
// applies elsewhere. gateWrite/ResolveMCPWrite/CancelMCPWrite stay in
// millmcpservice_approval.go; everything here is either called BY them
// (sweepLocked, emitExpired, emitMCPWriteActivity/ApprovalChanged) or
// reads the same m.writes map without ever mutating a pending decision.

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
// emitGuardrailPendingChanged uses. Takes plain fields rather than a
// *MCPWriteRecord deliberately -- every call site reads the record's
// fields it needs while still holding writesMu (the
// `description := rec.Description` pattern in millmcpservice_approval.go
// established this discipline first), so this only ever sees an
// already-safe snapshot.
func emitMCPWriteActivity(description, outcome, toolName, argsJSON, result string) {
	app := application.Get()
	if app == nil {
		return
	}
	app.Event.Emit("mcp-write-activity", MCPWriteActivity{
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
// path only needs to fire the SAME event, never a second channel. The
// bug this fixes: ResolveMCPWrite (every outcome) and the lazy expiry
// sweep never fired it at all, so the sidebar badge could hold a
// phantom count against an already-empty queue until something else
// happened to trigger a refresh.
//
// Emits a zero-value MCPWriteRequest, NOT an empty struct{} -- found
// live, not assumed: main.go's application.RegisterEvent[MCPWriteRequest]
// ("mcp-write-approval") documents that Wails3 "matches data types
// exactly and no conversion is performed," so an struct{}{} payload
// silently failed this event's own type check and was dropped before
// ever reaching a browser client -- a real bug an e2e run caught (the
// sidebar badge, which has no polling fallback unlike ReviewView's own
// 2s interval, stayed stuck on a stale count). Every listener still
// ignores evt.data and just refetches; this only has to satisfy the
// registered type, not carry real content.
func emitMCPWriteApprovalChanged() {
	app := application.Get()
	if app == nil {
		return
	}
	app.Event.Emit("mcp-write-approval", MCPWriteRequest{})
}

// expiredWrite snapshots the fields emitMCPWriteActivity needs for one
// record sweepLocked just expired -- captured while writesMu is still
// held (same read-before-unlock discipline as ResolveMCPWrite/
// CancelMCPWrite's own local variables), since the record itself may be
// deleted by a later sweep before the caller gets around to emitting.
type expiredWrite struct {
	Description string
	ToolName    string
	ArgsJSON    string
	Error       string
}

// sweepLocked lazily transitions any pending record whose 24h window
// has elapsed to expired, and deletes any terminal record whose own
// 24h-since-resolution retention has elapsed -- caller must hold
// writesMu. Returns a snapshot of every record that just expired, for
// the caller to push an Activity row (and the pending-changed signal,
// docs/goals/0026 item 5) for once unlocked.
func (m *MillMCPService) sweepLocked(now time.Time) []expiredWrite {
	var expired []expiredWrite
	changed := false
	for id, rec := range m.writes {
		if rec.Status == MCPWriteStatusPending && now.Sub(rec.CreatedAt) > mcpWriteExpiry {
			rec.Status = MCPWriteStatusExpired
			rec.Error = "no human decision within 24h"
			rec.ResolvedAt = &now
			expired = append(expired, expiredWrite{
				Description: rec.Description, ToolName: rec.ToolName, ArgsJSON: rec.ArgsJSON, Error: rec.Error,
			})
			changed = true
			continue
		}
		if rec.Status != MCPWriteStatusPending && rec.ResolvedAt != nil && now.Sub(*rec.ResolvedAt) > mcpWriteExpiry {
			delete(m.writes, id)
			changed = true
		}
	}
	if changed {
		// Incidental bookkeeping riding along a read call (PendingMCPWrites/
		// writeStatus/ResolveMCPWrite/loadWrites all call this) -- log-only,
		// same fire-and-forget treatment as the compositionsvc/configuresvc
		// top-up-seeding sweeps (docs/goals/0025 item 1). A failure here
		// just means the same records get swept again on the next call.
		if err := m.persistWritesLocked(); err != nil {
			slog.Error("failed to persist MCP write sweep", "error", err)
		}
	}
	return expired
}

// emitExpired pushes an Activity row for every record sweepLocked just
// expired, and -- the docs/goals/0026 item 5 bug fix's other half --
// pings the pending-changed signal exactly once if anything expired, so
// the sidebar badge/queue counts drop even when nobody happened to call
// ResolveMCPWrite/CancelMCPWrite around the same sweep.
func (m *MillMCPService) emitExpired(expired []expiredWrite) {
	for _, e := range expired {
		emitMCPWriteActivity(e.Description, string(MCPWriteStatusExpired), e.ToolName, e.ArgsJSON, e.Error)
	}
	if len(expired) > 0 {
		emitMCPWriteApprovalChanged()
	}
}

// PendingMCPWrites lists writes currently awaiting a human decision,
// oldest first -- sweeps lazily first so a since-expired record never
// shows up as still pending.
func (m *MillMCPService) PendingMCPWrites() []MCPWriteRequest {
	m.writesMu.Lock()
	expired := m.sweepLocked(time.Now())
	out := make([]MCPWriteRequest, 0, len(m.writes))
	for _, rec := range m.writes {
		if rec.Status == MCPWriteStatusPending {
			out = append(out, MCPWriteRequest{ID: rec.ID, Description: rec.Description, CreatedAt: rec.CreatedAt, LastPolledAt: rec.LastPolledAt})
		}
	}
	m.writesMu.Unlock()
	m.emitExpired(expired)

	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt.Before(out[j].CreatedAt) })
	return out
}

// ResolvedMCPWrites lists every already-resolved write still in the 24h
// retention window (docs/goals/0026 item 6) -- newest-resolved first,
// the same "queue's own history must include write resolutions"
// Review's Recently-resolved section merges alongside RunSummary's own
// resolved runs. Sweeps lazily first, same as every other read here.
func (m *MillMCPService) ResolvedMCPWrites() []MCPWriteResolved {
	m.writesMu.Lock()
	expired := m.sweepLocked(time.Now())
	out := make([]MCPWriteResolved, 0)
	for _, rec := range m.writes {
		if rec.Status == MCPWriteStatusPending || rec.ResolvedAt == nil {
			continue
		}
		out = append(out, MCPWriteResolved{
			ID: rec.ID, Description: rec.Description, Status: string(rec.Status),
			Error: rec.Error, CreatedAt: rec.CreatedAt, ResolvedAt: *rec.ResolvedAt,
		})
	}
	m.writesMu.Unlock()
	m.emitExpired(expired)

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
// server only ever reads it once at startup (loadWrites) and treats
// m.writes as the live source of truth from then on, so an external
// file edit would simply be overwritten by the next persist -- this is
// the in-process equivalent, shifting an already-parked record's
// CreatedAt back so a real 15m/24h age-tier render can be exercised
// without sleeping real minutes/hours. Gated by the caller
// (SettingsService.DebugBackdatePendingMCPWrite) to isolated test data
// only -- never reachable against a real production instance.
func (m *MillMCPService) DebugBackdatePendingWrite(id string, ageMinutes int) error {
	m.writesMu.Lock()
	rec, ok := m.writes[id]
	if !ok {
		m.writesMu.Unlock()
		return fmt.Errorf("no MCP write with id %s", id)
	}
	if rec.Status != MCPWriteStatusPending {
		m.writesMu.Unlock()
		return fmt.Errorf("MCP write %s is not pending", id)
	}
	rec.CreatedAt = time.Now().Add(-time.Duration(ageMinutes) * time.Minute)
	err := m.persistWritesLocked()
	m.writesMu.Unlock()
	// Every poll-less surface (the banner, the floating approval prompt)
	// only refreshes on this event -- without it, a backdated write
	// would render stale until something else happened to trigger a
	// refetch (ReviewView's own 2s poll would mask that, same class of
	// masking item 5's bug fix already caught once).
	emitMCPWriteApprovalChanged()
	return err
}

// writeStatus sweeps lazily, then returns a snapshot of rec's outcome
// fields -- used by check_write_status. Also records LastPolledAt
// (docs/goals/0026 item 3) -- check_write_status IS the requester's own
// heartbeat, so every real poll (a hit, not a miss) updates it and
// persists, same as every other lifecycle mutation in this file.
func (m *MillMCPService) writeStatus(id string) (checkWriteStatusResult, bool) {
	m.writesMu.Lock()
	expired := m.sweepLocked(time.Now())
	rec, ok := m.writes[id]
	var res checkWriteStatusResult
	if ok {
		now := time.Now()
		rec.LastPolledAt = &now
		if err := m.persistWritesLocked(); err != nil {
			slog.Error("failed to persist MCP write poll timestamp", "error", err)
		}
		res = checkWriteStatusResult{Status: string(rec.Status), Description: rec.Description, Result: rec.ResultText, Error: rec.Error}
	}
	m.writesMu.Unlock()
	m.emitExpired(expired)
	return res, ok
}
