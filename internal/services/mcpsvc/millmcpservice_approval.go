package mcpsvc

import (
	"encoding/json"
	"fmt"
	"sort"
	"time"

	"github.com/google/uuid"
	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/wailsapp/wails/v3/pkg/application"
)

// Per-write MCP approval lifecycle: park-and-poll (docs/adr/0032,
// superseding the old bounded-120s-blocking-wait shape). A gated write
// tool call submits (description, toolName, argsJSON) to gateWrite,
// which parks the write itself -- not a live channel -- as a durable
// MCPWriteRecord persisted via the settings store, so an approval can
// execute the write later even if the requester (or Mill itself) has
// since restarted. A short in-call courtesy window (10s) keeps the
// co-present-approver case a single round trip; past that, the call
// returns a SUCCESSFUL parked-pending text so the client polls
// check_write_status instead of the connection dying against a real
// host's own ~60s to-first-byte timer (ADR-0032's own research).

// MCPWriteApprovalKey: when writes are enabled at all
// (MCPWriteEnabledKey), this second toggle decides whether each write
// still needs a human click. Defaults to REQUIRED when unset -- enabling
// writes must not silently mean unattended writes (§8's fail-safe
// default); relaxing to unattended is its own explicit opt-out.
const MCPWriteApprovalKey = "mcp-write-approval-required"

// mcpPendingWritesKey persists every MCPWriteRecord (pending and, for
// 24h, resolved) as one JSON blob -- same one-atomic-blob-per-key shape
// every other settings.Store consumer in this repo already uses.
const mcpPendingWritesKey = "mcp-pending-writes"

// mcpWriteCourtesyWindow is how long a gated write call blocks
// in-process hoping for a co-present approver before returning the
// parked-pending-approval text (docs/adr/0032 §1: "safely under the 60s
// transport timer"). A package var, not a const, so tests can shrink it
// instead of sleeping 10 real seconds.
var mcpWriteCourtesyWindow = 10 * time.Second

// mcpWriteExpiry is how long an unresolved pending record stays
// pending before a lazy sweep marks it expired, and how long a
// resolved/expired record stays queryable via check_write_status
// before being swept away entirely -- matches the guardrail park's own
// timeout (§8), not a new number. A package var so tests can shrink or
// backdate around it instead of sleeping 24 real hours.
var mcpWriteExpiry = 24 * time.Hour

// MCPWriteStatus is one pending write's lifecycle state.
type MCPWriteStatus string

const (
	MCPWriteStatusPending  MCPWriteStatus = "pending"
	MCPWriteStatusApproved MCPWriteStatus = "approved"
	MCPWriteStatusDenied   MCPWriteStatus = "denied"
	MCPWriteStatusExpired  MCPWriteStatus = "expired"
)

// MCPWriteRecord is one gated write's full durable lifecycle record --
// persisted via the settings store (mcpPendingWritesKey) so it survives
// a Mill restart (docs/adr/0032 §1: "the record... is what must be
// durable"). ToolName + ArgsJSON carry the write itself, re-dispatched
// by name through the executor registry at approval time -- a Go
// closure captured at request time can't survive a persisted record's
// trip through a restart.
type MCPWriteRecord struct {
	ID          string         `json:"id"`
	Description string         `json:"description"`
	ToolName    string         `json:"toolName"`
	ArgsJSON    string         `json:"argsJson"`
	CreatedAt   time.Time      `json:"createdAt"`
	Status      MCPWriteStatus `json:"status"`
	// ResultText is the executor's own success text, set once approved
	// and the write itself succeeds.
	ResultText string `json:"resultText,omitempty"`
	// Error explains a denial ("denied by the user..."), an expiry, or
	// -- distinctly -- an approved write whose own execution failed
	// (Status stays "approved", since the human's decision was to
	// approve it; Error then carries the write's own failure).
	Error      string     `json:"error,omitempty"`
	ResolvedAt *time.Time `json:"resolvedAt,omitempty"`

	// decision signals the courtesy-window select in gateWrite once
	// ResolveMCPWrite finalizes this record -- unexported, so
	// encoding/json already skips it with no explicit tag needed;
	// rebuilt on load (loadWrites) for any record that survived a
	// restart. Buffered size 1: ResolveMCPWrite's send must never block
	// on whether anyone is still listening (the original in-call
	// courtesy window may have already returned).
	decision chan struct{}
}

// MCPWriteRequest is the frontend-facing shape for a still-PENDING
// write (the "mcp-write-approval" event payload and PendingMCPWrites'
// own return type) -- narrower than MCPWriteRecord (no ToolName/
// ArgsJSON/executor internals), same field names the banner/Review UI
// already bind against.
type MCPWriteRequest struct {
	ID          string    `json:"id"`
	Description string    `json:"description"`
	CreatedAt   time.Time `json:"createdAt"`
}

// MCPWriteActivity is pushed for a missed (expired) or denied MCP
// write so it's no longer traceless (docs/goals/0005-pending-attention-
// model.md item 3). Reuses the same activity-push shape App.tsx's
// hotkey-activity handler already established, under a distinct
// "mcp-write" ActivitySource so it's filterable, not conflated with a
// workflow trigger.
type MCPWriteActivity struct {
	Description string `json:"description"`
	// Outcome is "denied" or "expired" -- an approved write never
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

// mcpWriteExecutor performs one gated write's real side effect, keyed
// by tool name in MillMCPService.executors (registerWriteExecutor).
// Dispatch-by-name (rather than a captured closure) is what lets
// approval-time execution survive a restart: a persisted MCPWriteRecord
// carries ToolName + ArgsJSON, never a func value.
type mcpWriteExecutor func(argsJSON string) (resultText string, err error)

// registerWriteExecutor wires one gated write tool's executor -- called
// from registerTools/registerAuthoringTools during construction, before
// any concurrent access is possible, so execute (below) reads
// m.executors without its own lock.
func (m *MillMCPService) registerWriteExecutor(toolName string, fn mcpWriteExecutor) {
	m.executors[toolName] = fn
}

// execute dispatches toolName's registered executor. m.executors is
// populated once at construction and never mutated afterward (see
// registerWriteExecutor's doc comment), so this is safe to call without
// m.writesMu.
func (m *MillMCPService) execute(toolName, argsJSON string) (string, error) {
	fn, ok := m.executors[toolName]
	if !ok {
		return "", fmt.Errorf("no registered executor for MCP write tool %q", toolName)
	}
	return fn(argsJSON)
}

// gateWrite is the shared park-and-poll gate every mutation tool call
// runs through (docs/adr/0032 §1). When approval isn't required it
// executes immediately, matching the pre-ADR-0032 behavior. Otherwise
// it parks a durable record, waits the courtesy window for a co-present
// approver, and either returns the final result (approved/denied
// inside the window) or a successful parked-pending text (still
// undecided at the window's end) -- never an error for the parked case,
// so a real client keeps polling instead of giving up.
func (m *MillMCPService) gateWrite(toolName, description, argsJSON string) (*mcp.CallToolResult, error) {
	if !m.approvalRequired() {
		text, err := m.execute(toolName, argsJSON)
		if err != nil {
			return nil, err
		}
		return textResult(text), nil
	}

	rec := &MCPWriteRecord{
		ID:          uuid.NewString(),
		Description: description,
		ToolName:    toolName,
		ArgsJSON:    argsJSON,
		CreatedAt:   time.Now(),
		Status:      MCPWriteStatusPending,
		decision:    make(chan struct{}, 1),
	}
	m.writesMu.Lock()
	if m.writes == nil {
		m.writes = map[string]*MCPWriteRecord{}
	}
	m.writes[rec.ID] = rec
	m.persistWritesLocked()
	m.writesMu.Unlock()

	// Surface it to the desktop window; the frontend also polls
	// PendingMCPWrites on mount, so a request raised while the window
	// was closed still shows up.
	if app := application.Get(); app != nil {
		app.Event.Emit("mcp-write-approval", MCPWriteRequest{ID: rec.ID, Description: rec.Description, CreatedAt: rec.CreatedAt})
	}

	select {
	case <-rec.decision:
		m.writesMu.Lock()
		status, resultText, errText := rec.Status, rec.ResultText, rec.Error
		m.writesMu.Unlock()
		if status == MCPWriteStatusDenied || (status == MCPWriteStatusApproved && errText != "") {
			return nil, fmt.Errorf("%s", errText)
		}
		return textResult(resultText), nil
	case <-time.After(mcpWriteCourtesyWindow):
		return textResult(fmt.Sprintf(
			"parked pending human approval; id=%s; call check_write_status with this id", rec.ID,
		)), nil
	}
}

// finalizeLocked transitions rec to a terminal state and persists it --
// caller must hold writesMu. Does not signal or emit an Activity row;
// callers do that themselves after unlocking (an Activity push touches
// the Wails event system, kept out of the critical section on
// principle, same as the pre-ADR-0032 code's own lock-free emit).
func (m *MillMCPService) finalizeLocked(rec *MCPWriteRecord, status MCPWriteStatus, resultText, errText string) {
	now := time.Now()
	rec.Status = status
	rec.ResultText = resultText
	rec.Error = errText
	rec.ResolvedAt = &now
	m.persistWritesLocked()
}

// signalLocked wakes a courtesy-window select still waiting on rec, if
// any -- a non-blocking buffered send, since resolution routinely
// happens well after the window already returned. Caller must hold
// writesMu.
func (m *MillMCPService) signalLocked(rec *MCPWriteRecord) {
	if rec.decision == nil {
		rec.decision = make(chan struct{}, 1)
	}
	select {
	case rec.decision <- struct{}{}:
	default:
	}
}

// ResolveMCPWrite delivers the human's decision to a parked write. On
// approve, the write's registered executor runs INSIDE the same lock
// hold that checked the record was still pending -- the at-most-once
// guarantee (docs/adr/0032 §1) this way needs no separate compare-and-
// swap: two concurrent resolutions of the same id can't both observe
// Status==pending. An approved write whose own execution then fails is
// still a successful *approval* (Status stays "approved"); the failure
// is carried in Error, visible to check_write_status and to the
// courtesy-window caller if still connected.
func (m *MillMCPService) ResolveMCPWrite(id string, approve bool) error {
	m.writesMu.Lock()
	expiredDuringSweep := m.sweepLocked(time.Now())

	rec, ok := m.writes[id]
	if !ok {
		m.writesMu.Unlock()
		m.emitExpired(expiredDuringSweep)
		return fmt.Errorf("no MCP write with id %s (it may have already been swept, 24h after resolution)", id)
	}
	if rec.Status != MCPWriteStatusPending {
		m.writesMu.Unlock()
		m.emitExpired(expiredDuringSweep)
		return fmt.Errorf("MCP write %s was already resolved (%s)", id, rec.Status)
	}

	var activityOutcome string
	if !approve {
		m.finalizeLocked(rec, MCPWriteStatusDenied, "", "denied by the user in Mill's window")
		activityOutcome = string(MCPWriteStatusDenied)
	} else {
		resultText, err := m.execute(rec.ToolName, rec.ArgsJSON)
		if err != nil {
			m.finalizeLocked(rec, MCPWriteStatusApproved, "", err.Error())
		} else {
			m.finalizeLocked(rec, MCPWriteStatusApproved, resultText, "")
		}
	}
	m.signalLocked(rec)
	description := rec.Description
	m.writesMu.Unlock()

	m.emitExpired(expiredDuringSweep)
	if activityOutcome != "" {
		emitMCPWriteActivity(description, activityOutcome)
	}
	return nil
}

// persistWritesLocked marshals m.writes to the settings store -- caller
// must hold writesMu. Best-effort: a marshal failure here would be a
// Mill bug (every field is a plain string/time/enum), not a runtime
// condition worth surfacing mid-call.
func (m *MillMCPService) persistWritesLocked() {
	data, err := json.Marshal(m.writes)
	if err != nil {
		return
	}
	_ = m.store.Set(mcpPendingWritesKey, string(data))
}

// loadWrites reloads every persisted MCPWriteRecord from the settings
// store -- called once from NewMillMCPService, the restart-survival
// half of docs/adr/0032 §1. Each pending record's decision channel is
// unexported and so never persisted; rebuilt here so ResolveMCPWrite
// can always signal safely even for a record that outlived a restart
// (nothing is listening on it in that case -- the buffered, non-
// blocking send in signalLocked handles that fine).
func (m *MillMCPService) loadWrites() {
	m.writesMu.Lock()
	defer m.writesMu.Unlock()
	m.writes = map[string]*MCPWriteRecord{}
	if raw, ok := m.store.Get(mcpPendingWritesKey).(string); ok && raw != "" {
		var loaded map[string]*MCPWriteRecord
		if err := json.Unmarshal([]byte(raw), &loaded); err == nil {
			m.writes = loaded
		}
	}
	for _, rec := range m.writes {
		if rec.decision == nil {
			rec.decision = make(chan struct{}, 1)
		}
	}
	// Discard the expired list here rather than emitting Activity rows:
	// no window is open yet at construction time for anyone to see
	// them, and the record itself is still correctly marked expired
	// either way -- a later PendingMCPWrites/check_write_status/
	// ResolveMCPWrite call sweeps again and emits normally for anything
	// that expires from then on.
	_ = m.sweepLocked(time.Now())
}

// sweepLocked lazily transitions any pending record whose 24h window
// has elapsed to expired, and deletes any terminal record whose own
// 24h-since-resolution retention has elapsed -- caller must hold
// writesMu. Returns the descriptions of records that just expired, for
// the caller to push an Activity row for once unlocked.
func (m *MillMCPService) sweepLocked(now time.Time) []string {
	var expired []string
	changed := false
	for id, rec := range m.writes {
		if rec.Status == MCPWriteStatusPending && now.Sub(rec.CreatedAt) > mcpWriteExpiry {
			rec.Status = MCPWriteStatusExpired
			rec.Error = "no human decision within 24h"
			rec.ResolvedAt = &now
			expired = append(expired, rec.Description)
			changed = true
			continue
		}
		if rec.Status != MCPWriteStatusPending && rec.ResolvedAt != nil && now.Sub(*rec.ResolvedAt) > mcpWriteExpiry {
			delete(m.writes, id)
			changed = true
		}
	}
	if changed {
		m.persistWritesLocked()
	}
	return expired
}

func (m *MillMCPService) emitExpired(descriptions []string) {
	for _, d := range descriptions {
		emitMCPWriteActivity(d, string(MCPWriteStatusExpired))
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
			out = append(out, MCPWriteRequest{ID: rec.ID, Description: rec.Description, CreatedAt: rec.CreatedAt})
		}
	}
	m.writesMu.Unlock()
	m.emitExpired(expired)

	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt.Before(out[j].CreatedAt) })
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

// writeStatus sweeps lazily, then returns a snapshot of rec's outcome
// fields -- used by check_write_status.
func (m *MillMCPService) writeStatus(id string) (checkWriteStatusResult, bool) {
	m.writesMu.Lock()
	expired := m.sweepLocked(time.Now())
	rec, ok := m.writes[id]
	var res checkWriteStatusResult
	if ok {
		res = checkWriteStatusResult{Status: string(rec.Status), Description: rec.Description, Result: rec.ResultText, Error: rec.Error}
	}
	m.writesMu.Unlock()
	m.emitExpired(expired)
	return res, ok
}
