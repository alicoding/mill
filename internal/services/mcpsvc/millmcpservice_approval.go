package mcpsvc

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/alicoding/mill/internal/adapters/mcpaudit"
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
const MCPWriteApprovalKey = "mcp-write-approval-required" //nolint:gosec // a settings-store key name, not a credential (G101 false positive)

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
	// MCPWriteStatusCancelled is the requester's own withdrawal of a
	// still-pending write (docs/goals/0026 item 1) -- the missing fourth
	// verb alongside park/poll/resolve (tasks/cancel in the MCP Tasks
	// spec is the direct precedent ADR-0032 already mirrors for the rest
	// of this lifecycle). Deliberately distinct from denied: nobody
	// weighed in and said no, the requester simply stopped needing it.
	MCPWriteStatusCancelled MCPWriteStatus = "cancelled"
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
	// LastPolledAt records the most recent check_write_status call for
	// this write (docs/goals/0026 item 3, decided without further
	// research) -- polling IS the natural requester heartbeat, so a
	// pending write nobody has checked on in a while visibly reads as
	// abandoned rather than merely old. Persisted like every other
	// lifecycle field so it survives a restart.
	LastPolledAt *time.Time `json:"lastPolledAt,omitempty"`

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
	// LastPolledAt mirrors MCPWriteRecord's own field (docs/goals/0026
	// item 3) -- nil when the requester has never called
	// check_write_status on this id yet.
	LastPolledAt *time.Time `json:"lastPolledAt,omitempty"`
}

// MCPWriteResolved is the frontend-facing shape for an already-resolved
// write (docs/goals/0026 item 6) -- Review's Recently-resolved section
// reads this alongside RunSummary's own resolved rows, merged
// newest-first. Retained for the same 24h window check_write_status
// already promises (sweepLocked's own retention) -- "durable across a
// restart" and "still visible for the same window an MCP client can
// still poll" are the same guarantee, not two.
type MCPWriteResolved struct {
	ID          string    `json:"id"`
	Description string    `json:"description"`
	Status      string    `json:"status"` // approved / denied / cancelled / expired
	Error       string    `json:"error,omitempty"`
	CreatedAt   time.Time `json:"createdAt"`
	ResolvedAt  time.Time `json:"resolvedAt"`
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
	if err := m.persistWritesLocked(); err != nil {
		// The record's durability across a restart is the entire point
		// of parking it (docs/adr/0032 §1: "the record... is what must
		// be durable") -- a record that only lives in memory isn't a
		// real park, so don't leave a phantom-parked write behind; fail
		// the call instead (docs/goals/0025 items 1/2).
		delete(m.writes, rec.ID)
		m.writesMu.Unlock()
		return nil, fmt.Errorf("park write for approval: %w", err)
	}
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
		// Denied and cancelled both mean the original call never gets
		// the write it asked for -- an error either way, distinguished
		// only in the persisted record/Activity row, not in this
		// in-flight caller's own result (docs/goals/0026 item 1).
		if status == MCPWriteStatusDenied || status == MCPWriteStatusCancelled || (status == MCPWriteStatusApproved && errText != "") {
			return nil, fmt.Errorf("%s", errText)
		}
		return textResult(resultText), nil
	case <-time.After(mcpWriteCourtesyWindow):
		return textResult(mcpaudit.ParkedPendingText(rec.ID)), nil
	}
}

// finalizeLocked transitions rec to a terminal state and persists it --
// caller must hold writesMu. Does not signal or emit an Activity row;
// callers do that themselves after unlocking (an Activity push touches
// the Wails event system, kept out of the critical section on
// principle, same as the pre-ADR-0032 code's own lock-free emit).
//
// Deliberately does NOT roll rec's in-memory fields back on a persist
// failure, unlike every other rollback-on-persist-failure site in this
// change (docs/goals/0025 items 1/2): for an approved write, the real
// side effect (m.execute, called by ResolveMCPWrite before this runs)
// has already happened by the time this is reached, so reverting
// Status back to "pending" would let a second ResolveMCPWrite call
// re-run that same executor after a crash/restart wiped the
// unpersisted change -- a real double-execution risk strictly worse
// than a resolution that's merely slow to durably record. The error is
// still returned and surfaced to the human (a durability gap worth
// knowing about), it just doesn't undo a decision that's already real.
func (m *MillMCPService) finalizeLocked(rec *MCPWriteRecord, status MCPWriteStatus, resultText, errText string) error {
	now := time.Now()
	rec.Status = status
	rec.ResultText = resultText
	rec.Error = errText
	rec.ResolvedAt = &now
	if err := m.persistWritesLocked(); err != nil {
		return fmt.Errorf("save write resolution: %w", err)
	}
	return nil
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
	var finalizeErr error
	if !approve {
		finalizeErr = m.finalizeLocked(rec, MCPWriteStatusDenied, "", mcpaudit.DeniedInWindowText)
		activityOutcome = string(MCPWriteStatusDenied)
	} else {
		resultText, err := m.execute(rec.ToolName, rec.ArgsJSON)
		if err != nil {
			finalizeErr = m.finalizeLocked(rec, MCPWriteStatusApproved, "", err.Error())
		} else {
			finalizeErr = m.finalizeLocked(rec, MCPWriteStatusApproved, resultText, "")
		}
		activityOutcome = string(MCPWriteStatusApproved)
	}
	// Signal regardless of finalizeErr -- the decision (and, for
	// approve, the real side effect) already happened; a courtesy-window
	// caller still waiting must not hang just because the durable record
	// of it lagged.
	m.signalLocked(rec)
	// Every field emitMCPWriteActivity needs, captured while the lock is
	// still held (docs/goals/0026 item 7) -- reading rec's fields after
	// Unlock below would be the exact data race the pre-existing
	// `description := rec.Description` line already avoided for
	// Description alone; extended here to the new fields.
	description, toolName, argsJSON, resultText, errText := rec.Description, rec.ToolName, rec.ArgsJSON, rec.ResultText, rec.Error
	m.writesMu.Unlock()

	// Mutates this write's own OutcomeParked audit row (goal 0159 slice
	// 1) to its terminal value -- a no-op when SetAuditResolver was
	// never wired (tests that don't care about the audit trail).
	if m.auditResolver != nil {
		if activityOutcome == string(MCPWriteStatusDenied) {
			m.auditResolver(id, mcpaudit.OutcomeParkedDenied, errText)
		} else {
			m.auditResolver(id, mcpaudit.OutcomeParkedApproved, errText)
		}
	}

	m.emitExpired(expiredDuringSweep)
	result := resultText
	if result == "" {
		result = errText
	}
	if result == "" {
		result = description
	}
	// An approved write whose own execution then failed is still an
	// "approved" Status (the human's decision was to approve it -- see
	// finalizeLocked's own doc comment), but Activity's own outcome
	// vocabulary only ever showed "denied"/"expired" before this --
	// only push a real Activity row for the two genuinely traceless
	// outcomes (deny, and an approval whose write itself failed);
	// approved-and-succeeded already has a visible trace (the new
	// entity itself, plus check_write_status/Review's own resolved
	// list, docs/goals/0026 item 6).
	if activityOutcome == string(MCPWriteStatusDenied) || (activityOutcome == string(MCPWriteStatusApproved) && errText != "") {
		emitMCPWriteActivity(description, activityOutcome, toolName, argsJSON, result)
	}
	// The pending-count signal fires on EVERY resolution outcome,
	// unconditionally -- unlike the Activity push above, a resolved
	// write must always stop counting as pending regardless of whether
	// it also gets an Activity row (docs/goals/0026 item 5, the BUG this
	// whole function previously never emitted this for at all).
	emitMCPWriteApprovalChanged()
	if finalizeErr != nil {
		// The decision (and any real side effect) is final either way --
		// this error means it failed to durably RECORD, which the human
		// resolving it from Mill's window should still learn about
		// (docs/goals/0025 items 1/2's "approval-record" case), not a
		// silent `_ =`.
		return finalizeErr
	}
	return nil
}

// CancelMCPWrite lets the requester withdraw its own still-pending
// write (docs/goals/0026 item 1 -- the missing fourth verb, park/poll/
// resolve/WITHDRAW; MCP Tasks' own tasks/cancel is the direct precedent
// ADR-0032 already mirrors for the rest of this lifecycle). Cancelled
// is a DISTINCT terminal outcome from denied: nobody weighed in and
// said no, the requester simply stopped needing it -- recorded and
// surfaced identically to denied/expired (never traceless). Ungated:
// cancelling your own request only ever REDUCES pending work, so no
// approval/write-toggle gate applies here (same "ungated" shape as
// check_write_status, not gateWrite's). At-most-once, same locking
// shape as ResolveMCPWrite -- two concurrent cancel/resolve calls on
// the same id can't both observe Status==pending.
func (m *MillMCPService) CancelMCPWrite(id string) error {
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

	finalizeErr := m.finalizeLocked(rec, MCPWriteStatusCancelled, "", "cancelled by the requester")
	// Signal regardless of finalizeErr, same reasoning as
	// ResolveMCPWrite's own decision-already-happened comment -- a
	// courtesy-window caller (unlikely for a self-cancel, since the
	// requester is usually the one who'd be blocked in it, but not
	// impossible if a second client polls) must not hang on a
	// durability lag.
	m.signalLocked(rec)
	description, toolName, argsJSON := rec.Description, rec.ToolName, rec.ArgsJSON
	m.writesMu.Unlock()

	// See ResolveMCPWrite's own doc comment -- same goal 0159 slice 1
	// audit-row mutation, OutcomeParkedCancelled being the fourth Parked*
	// value this repo's own write lifecycle needs beyond the three the
	// design contract named.
	if m.auditResolver != nil {
		m.auditResolver(id, mcpaudit.OutcomeParkedCancelled, "cancelled by the requester")
	}

	m.emitExpired(expiredDuringSweep)
	emitMCPWriteActivity(description, string(MCPWriteStatusCancelled), toolName, argsJSON, description)
	emitMCPWriteApprovalChanged()
	if finalizeErr != nil {
		return finalizeErr
	}
	return nil
}

// persistWritesLocked marshals m.writes to the settings store -- caller
// must hold writesMu. Returns the marshal/store error rather than
// swallowing it (docs/goals/0025 item 1) -- callers decide whether to
// propagate (gateWrite/finalizeLocked, an approval-record write) or log
// (sweepLocked's own incidental bookkeeping, below).
func (m *MillMCPService) persistWritesLocked() error {
	data, err := json.Marshal(m.writes)
	if err != nil {
		return fmt.Errorf("marshal pending MCP writes: %w", err)
	}
	if err := m.store.Set(mcpPendingWritesKey, string(data)); err != nil {
		return fmt.Errorf("persist pending MCP writes: %w", err)
	}
	return nil
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
