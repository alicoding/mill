package mcpsvc

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/alicoding/mill/internal/adapters/mcpaudit"
	"github.com/alicoding/mill/internal/adapters/windowing"
	"github.com/alicoding/mill/internal/services/guardrailsvc"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// Per-write MCP approval lifecycle: park-and-poll (docs/adr/0032,
// superseding the old bounded-120s-blocking-wait shape). gateWrite first
// judges the write through the shared guardrail rule-evaluation core
// (writeVerdictShortCircuit, millmcpservice_approval_guardrail.go --
// docs/adr/0047 §5.4): an explicit allow/deny rule short-circuits the
// park entirely; the ask default (no rule, matching pre-rebase behavior)
// parks the write itself -- not a live channel -- through the shared
// durable pending-action store (guardrailsvc.PendingActionStore,
// docs/adr/0047 §5.4's follow-up), so an approval can execute the write
// later even if the requester (or Mill itself) has since restarted. A
// short in-call courtesy window (10s) keeps a co-present approver to
// one round trip; past that, the call returns a SUCCESSFUL
// parked-pending text so the client polls check_write_status instead of
// the connection dying against a real host's own ~60s to-first-byte
// timer (ADR-0032's own research).

// MCPWriteApprovalKey: when writes are enabled at all
// (MCPWriteEnabledKey), this second toggle decides whether each write
// still needs a human click. Defaults to REQUIRED when unset -- enabling
// writes must not silently mean unattended writes (§8's fail-safe
// default); relaxing to unattended is its own explicit opt-out.
const MCPWriteApprovalKey = "mcp-write-approval-required" //nolint:gosec // a settings-store key name, not a credential (G101 false positive)

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
// timeout (§8), not a new number. Passed explicitly as the retention
// argument to every m.parkStore call (the shared store takes retention
// per-call, not as a package var -- see
// guardrailsvc.PendingActionStore's own defaultGuardedActionRetention
// doc comment for why), so shrinking this package var here still
// controls this package's own sweep timing exactly as it always has.
// A package var, not a const, so tests can shrink or backdate around it
// instead of sleeping 24 real hours.
var mcpWriteExpiry = 24 * time.Hour

// MCPWriteStatus is one pending write's lifecycle state -- string
// values are this package's own wire contract (check_write_status,
// Review, the sidebar badge), kept independent of
// guardrailsvc.GuardedActionStatus's own vocabulary at the seam
// (mcpStatusFrom) rather than aliased to it, so a future change to
// either vocabulary can never silently ripple into the other.
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

// mcpStatusFrom converts the shared store's generic status into this
// package's own wire vocabulary -- see MCPWriteStatus's own doc
// comment for why these stay two independent string sets rather than
// one aliased to the other.
func mcpStatusFrom(s guardrailsvc.GuardedActionStatus) MCPWriteStatus {
	switch s {
	case guardrailsvc.GuardedActionApproved:
		return MCPWriteStatusApproved
	case guardrailsvc.GuardedActionDenied:
		return MCPWriteStatusDenied
	case guardrailsvc.GuardedActionExpired:
		return MCPWriteStatusExpired
	case guardrailsvc.GuardedActionCancelled:
		return MCPWriteStatusCancelled
	default:
		return MCPWriteStatusPending
	}
}

// mcpWritePayload is what this package carries as the shared store's
// opaque Payload -- ToolName + ArgsJSON re-dispatched by name through
// the executor registry at approval time (see execute's own doc
// comment): a Go closure can't survive a persisted record's trip
// through a restart, dispatch-by-name through a marshaled payload can.
type mcpWritePayload struct {
	ToolName string `json:"toolName"`
	ArgsJSON string `json:"argsJson"`
}

// MCPWriteRequest is the frontend-facing shape for a still-PENDING
// write (the "mcp-write-approval" event payload and PendingMCPWrites'
// own return type) -- narrower than the shared store's own
// GuardedActionRecord (no ToolName/ArgsJSON/executor internals), same
// field names the banner/Review UI already bind against.
type MCPWriteRequest struct {
	ID          string    `json:"id"`
	Description string    `json:"description"`
	CreatedAt   time.Time `json:"createdAt"`
	// LastPolledAt mirrors the shared record's own field (docs/goals/0026
	// item 3) -- nil when the requester has never called
	// check_write_status on this id yet.
	LastPolledAt *time.Time `json:"lastPolledAt,omitempty"`
}

// MCPWriteResolved is the frontend-facing shape for an already-resolved
// write (docs/goals/0026 item 6) -- Review's Recently-resolved section
// reads this alongside RunSummary's own resolved rows, merged
// newest-first. Retained for the same retention window check_write_status
// already promises (the shared store's own sweep) -- "durable across a
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
// approval-time execution survive a restart: a persisted payload
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
// a lock.
func (m *MillMCPService) execute(toolName, argsJSON string) (string, error) {
	fn, ok := m.executors[toolName]
	if !ok {
		return "", fmt.Errorf("no registered executor for MCP write tool %q", toolName)
	}
	return fn(argsJSON)
}

// applyMCPWrite is the apply-on-approve callback handed to the shared
// store's Resolve -- decodes the payload Park below encoded and
// dispatches through execute, run INSIDE Resolve's own lock hold (its
// own doc comment has the at-most-once reasoning).
func (m *MillMCPService) applyMCPWrite(payload []byte) (string, error) {
	var p mcpWritePayload
	if err := json.Unmarshal(payload, &p); err != nil {
		return "", fmt.Errorf("decode gated write payload: %w", err)
	}
	return m.execute(p.ToolName, p.ArgsJSON)
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

	// docs/adr/0047 §5.4: an explicit allow/deny rule short-circuits the
	// ask-every-time default here; "ask" (no rule, or no guardrail
	// service wired) falls through to the unchanged park below.
	if result, err, handled := m.writeVerdictShortCircuit(toolName, description, argsJSON); handled {
		return result, err
	}

	payload, err := json.Marshal(mcpWritePayload{ToolName: toolName, ArgsJSON: argsJSON})
	if err != nil {
		return nil, fmt.Errorf("marshal gated write payload: %w", err)
	}
	rec, err := m.parkStore.Park(guardrailsvc.GuardedAction{
		Kind: mcpWriteGuardrailKind, Attributes: map[string]string{"toolName": toolName}, Description: description, Source: "mcp",
	}, payload)
	if err != nil {
		// The record's durability across a restart is the entire point
		// of parking it (docs/adr/0032 §1: "the record... is what must
		// be durable") -- a record that only lives in memory isn't a
		// real park, so don't leave a phantom-parked write behind; fail
		// the call instead (docs/goals/0025 items 1/2).
		return nil, fmt.Errorf("park write for approval: %w", err)
	}

	// Surface it to the desktop window; the frontend also polls
	// PendingMCPWrites on mount, so a request raised while the window
	// was closed still shows up.
	windowing.Emit("mcp-write-approval", MCPWriteRequest{ID: rec.ID, Description: rec.Description, CreatedAt: rec.CreatedAt})

	resolved, decided := m.parkStore.AwaitDecision(rec.ID, mcpWriteCourtesyWindow)
	if !decided {
		return textResult(mcpaudit.ParkedPendingText(rec.ID)), nil
	}
	status := mcpStatusFrom(resolved.Status)
	// Denied and cancelled both mean the original call never gets the
	// write it asked for -- an error either way, distinguished only in
	// the persisted record/Activity row, not in this in-flight caller's
	// own result (docs/goals/0026 item 1).
	if status == MCPWriteStatusDenied || status == MCPWriteStatusCancelled || (status == MCPWriteStatusApproved && resolved.Error != "") {
		return nil, fmt.Errorf("%s", resolved.Error)
	}
	return textResult(resolved.ResultText), nil
}

// ResolveMCPWrite delivers the human's decision to a parked write. On
// approve, the write's registered executor runs INSIDE the shared
// store's own lock hold that checked the record was still pending --
// the at-most-once guarantee (docs/adr/0032 §1) this way needs no
// separate compare-and-swap: two concurrent resolutions of the same id
// can't both observe Status==pending (guardrailsvc.PendingActionStore.
// Resolve's own doc comment has the full reasoning, now shared by every
// caller of that store). An approved write whose own execution then
// fails is still a successful *approval* (Status stays "approved"); the
// failure is carried in Error, visible to check_write_status and to the
// courtesy-window caller if still connected.
func (m *MillMCPService) ResolveMCPWrite(id string, approve bool) error {
	var (
		resolved guardrailsvc.GuardedActionRecord
		expired  []guardrailsvc.GuardedActionRecord
		err      error
	)
	if approve {
		resolved, expired, err = m.parkStore.Resolve(id, true, "", mcpWriteExpiry, m.applyMCPWrite)
	} else {
		resolved, expired, err = m.parkStore.Resolve(id, false, mcpaudit.DeniedInWindowText, mcpWriteExpiry, nil)
	}
	m.emitExpired(expired)
	if err != nil {
		// Covers both "no such write" / "already resolved" (err != nil,
		// resolved is zero) and a persist failure on an otherwise-real
		// resolution (err != nil, resolved is populated) -- the caller
		// needs to see this error either way to learn about a durability
		// gap in the second case (docs/goals/0025 items 1/2's
		// "approval-record" case), not a silent `_ =`.
		if resolved.ID == "" {
			return err
		}
		m.finishResolve(id, resolved)
		return err
	}
	m.finishResolve(id, resolved)
	return nil
}

// finishResolve runs every side effect ResolveMCPWrite needs once the
// shared store has durably (or best-effort) recorded a decision --
// split out so both the persist-failure and clean-success paths above
// share it, since the decision (and any real side effect) is already
// final either way (Resolve's own doc comment).
func (m *MillMCPService) finishResolve(id string, resolved guardrailsvc.GuardedActionRecord) {
	status := mcpStatusFrom(resolved.Status)
	// Mutates this write's own OutcomeParked audit row (goal 0159 slice
	// 1) to its terminal value -- a no-op when SetAuditResolver was
	// never wired (tests that don't care about the audit trail).
	if m.auditResolver != nil {
		if status == MCPWriteStatusDenied {
			m.auditResolver(id, mcpaudit.OutcomeParkedDenied, resolved.Error)
		} else {
			m.auditResolver(id, mcpaudit.OutcomeParkedApproved, resolved.Error)
		}
	}

	result := resolved.ResultText
	if result == "" {
		result = resolved.Error
	}
	if result == "" {
		result = resolved.Description
	}
	toolName := ""
	if p, ok := decodeMCPWritePayload(resolved.Payload); ok {
		toolName = p.ToolName
	}
	// An approved write whose own execution then failed is still an
	// "approved" Status (the human's decision was to approve it -- see
	// the shared store's own Resolve doc comment), but Activity's own
	// outcome vocabulary only ever showed "denied"/"expired" before this
	// -- only push a real Activity row for the two genuinely traceless
	// outcomes (deny, and an approval whose write itself failed);
	// approved-and-succeeded already has a visible trace (the new
	// entity itself, plus check_write_status/Review's own resolved
	// list, docs/goals/0026 item 6).
	if status == MCPWriteStatusDenied || (status == MCPWriteStatusApproved && resolved.Error != "") {
		emitMCPWriteActivity(resolved.Description, string(status), toolName, argsJSONFromPayload(resolved.Payload), result)
	}
	// The pending-count signal fires on EVERY resolution outcome,
	// unconditionally -- unlike the Activity push above, a resolved
	// write must always stop counting as pending regardless of whether
	// it also gets an Activity row (docs/goals/0026 item 5).
	emitMCPWriteApprovalChanged()
}

// decodeMCPWritePayload best-effort decodes payload back into its
// {ToolName,ArgsJSON} shape -- payload is nil/unparseable for a record
// this package didn't itself park (defensive only; every record
// mcpsvc's own gateWrite parks always carries a valid payload).
func decodeMCPWritePayload(payload []byte) (mcpWritePayload, bool) {
	var p mcpWritePayload
	if len(payload) == 0 {
		return p, false
	}
	if err := json.Unmarshal(payload, &p); err != nil {
		return p, false
	}
	return p, true
}

func argsJSONFromPayload(payload []byte) string {
	p, _ := decodeMCPWritePayload(payload)
	return p.ArgsJSON
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
// shape as ResolveMCPWrite (the shared store's Withdraw) -- two
// concurrent cancel/resolve calls on the same id can't both observe
// Status==pending.
func (m *MillMCPService) CancelMCPWrite(id string) error {
	resolved, expired, err := m.parkStore.Withdraw(id, "cancelled by the requester", mcpWriteExpiry)
	m.emitExpired(expired)
	if err != nil {
		return err
	}

	// See ResolveMCPWrite's own doc comment -- same goal 0159 slice 1
	// audit-row mutation, OutcomeParkedCancelled being the fourth Parked*
	// value this repo's own write lifecycle needs beyond the three the
	// design contract named.
	if m.auditResolver != nil {
		m.auditResolver(id, mcpaudit.OutcomeParkedCancelled, "cancelled by the requester")
	}

	toolName := ""
	if p, ok := decodeMCPWritePayload(resolved.Payload); ok {
		toolName = p.ToolName
	}
	emitMCPWriteActivity(resolved.Description, string(MCPWriteStatusCancelled), toolName, argsJSONFromPayload(resolved.Payload), resolved.Description)
	emitMCPWriteApprovalChanged()
	return nil
}
