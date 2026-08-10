package mcpsvc

import (
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/wailsapp/wails/v3/pkg/application"
)

// Per-write MCP approval (docs/adr/0017's second half, docs/adr/0022's
// MCP section): when enabled, each import tool call parks on a BOUNDED
// in-process wait -- 120s, not indefinite, because the MCP spec's own
// 2026-07-28 Tasks extension exists precisely because hosts don't
// tolerate unboundedly-blocking tool calls -- while Mill's own window
// shows who's asking to write what. Deliberately NOT DBOS: an MCP tool
// call is a live RPC from an external process, not a durable Mill run;
// if either side dies, the write simply didn't happen (fail-safe), and
// there is nothing to resume.

// MCPWriteApprovalKey: when writes are enabled at all
// (MCPWriteEnabledKey), this second toggle decides whether each write
// still needs a human click. Defaults to REQUIRED when unset -- enabling
// writes must not silently mean unattended writes (§8's fail-safe
// default); relaxing to unattended is its own explicit opt-out.
const MCPWriteApprovalKey = "mcp-write-approval-required"

const mcpWriteApprovalTimeout = 120 * time.Second

// MCPWriteRequest is one pending write, as surfaced to the frontend
// (the Wails "mcp-write-approval" event and PendingMCPWrites).
type MCPWriteRequest struct {
	ID          string `json:"id"`
	Description string `json:"description"`
}

// MCPWriteActivity is pushed for a missed (timed-out) or denied MCP
// write so it's no longer traceless (docs/goals/0005-pending-attention-
// model.md item 3 -- solvable independent of MCP Tasks, one line at
// this timeout branch). Reuses the same activity-push shape App.tsx's
// hotkey-activity handler already established, under a distinct
// "mcp-write" ActivitySource so it's filterable, not conflated with a
// workflow trigger.
type MCPWriteActivity struct {
	Description string `json:"description"`
	// Outcome is "denied" or "timed out" -- an approved write never
	// reaches here, there's nothing traceless about it.
	Outcome string `json:"outcome"`
}

// emitMCPWriteActivity pushes MCPWriteActivity to the frontend.
// application.Get() is nil in a headless Go test process -- a no-op
// there, same guard executionservice_guardrail.go's
// emitGuardrailPendingChanged uses.
func emitMCPWriteActivity(description, outcome string) {
	app := application.Get()
	if app == nil {
		return
	}
	app.Event.Emit("mcp-write-activity", MCPWriteActivity{Description: description, Outcome: outcome})
}

func (m *MillMCPService) approvalRequired() bool {
	v, ok := m.store.Get(MCPWriteApprovalKey).(string)
	if !ok || v == "" {
		return true
	}
	return v == "true"
}

// awaitWriteApproval parks the calling MCP tool handler until a human
// resolves the request in Mill's UI, the timeout lapses (deny), or
// approval isn't required at all.
func (m *MillMCPService) awaitWriteApproval(description string) error {
	if !m.approvalRequired() {
		return nil
	}

	req := MCPWriteRequest{ID: uuid.NewString(), Description: description}
	ch := make(chan bool, 1)
	m.pendingMu.Lock()
	if m.pendingWrites == nil {
		m.pendingWrites = map[string]pendingMCPWrite{}
	}
	m.pendingWrites[req.ID] = pendingMCPWrite{req: req, decision: ch}
	m.pendingMu.Unlock()
	defer func() {
		m.pendingMu.Lock()
		delete(m.pendingWrites, req.ID)
		m.pendingMu.Unlock()
	}()

	// Surface it to the desktop window; the frontend also polls
	// PendingMCPWrites on mount, so a request raised while the window
	// was closed still shows up.
	if app := application.Get(); app != nil {
		app.Event.Emit("mcp-write-approval", req)
	}

	select {
	case approved := <-ch:
		if !approved {
			emitMCPWriteActivity(description, "denied")
			return fmt.Errorf("MCP write denied by the user in Mill's window")
		}
		return nil
	case <-time.After(mcpWriteApprovalTimeout):
		emitMCPWriteActivity(description, "timed out")
		return fmt.Errorf("MCP write not approved within %s -- approve it in Mill's window and retry "+
			"(or relax the per-write approval toggle in Settings)", mcpWriteApprovalTimeout)
	}
}

type pendingMCPWrite struct {
	req      MCPWriteRequest
	decision chan bool
}

// PendingMCPWrites lists writes currently awaiting a human decision.
func (m *MillMCPService) PendingMCPWrites() []MCPWriteRequest {
	m.pendingMu.Lock()
	defer m.pendingMu.Unlock()
	out := make([]MCPWriteRequest, 0, len(m.pendingWrites))
	for _, p := range m.pendingWrites {
		out = append(out, p.req)
	}
	return out
}

// ResolveMCPWrite delivers the human's decision to a parked write.
func (m *MillMCPService) ResolveMCPWrite(id string, approve bool) error {
	m.pendingMu.Lock()
	p, ok := m.pendingWrites[id]
	m.pendingMu.Unlock()
	if !ok {
		return fmt.Errorf("no pending MCP write with id %s (it may have timed out)", id)
	}
	select {
	case p.decision <- approve:
	default:
	}
	return nil
}
