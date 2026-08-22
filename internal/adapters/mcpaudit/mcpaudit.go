// Package mcpaudit holds the pure, dependency-free types for Mill's MCP
// call audit trail (goal 0159 slice 1) -- every field name mirrors an
// OTel GenAI/MCP semantic-convention attribute (adopted as naming
// CONVENTION only, per .claude/rules/architecture.md's Research->
// Adopt->Compose order; no OTel SDK dependency here, just the
// field-naming shape, so a future user-configured OTel exporter stays
// possible without phone-home now). Deliberately an adapter-layer
// package (docs/SPEC.md §1.4's Domain-->Adapters arrow, never the
// reverse) rather than internal/domain, since internal/adapters/mcpclient
// itself needs these types/helpers (caller-identity context plumbing)
// and adapters must not import domain. No persistence, no state --
// storage lives in internal/adapters/mcpauditstore, lifecycle in
// internal/services/mcpauditsvc.
package mcpaudit

import "time"

// Direction is which side of one MCP exchange Mill was on for this
// call -- "server" when an external client (or Mill's own agent loop,
// audited the same way, no special path) called Mill's own MCP server;
// "client" when Mill itself called a third-party MCP server's tool
// (the mcp-tool-call node's stdio connector).
type Direction string

const (
	DirectionServer Direction = "server"
	DirectionClient Direction = "client"
)

// Outcome is one call's recorded result. The three bare values cover
// every ordinary round trip; the four Parked* values are ONLY ever
// written for a server-received tools/call that hit Mill's own
// park-and-poll write gate (docs/adr/0032) -- OutcomeParked is the
// interim value a still-unresolved parked write carries until
// ResolveMCPWrite/CancelMCPWrite/the 24h expiry sweep mutates the same
// row to one of the three terminal Parked* outcomes.
type Outcome string

const (
	OutcomeSuccess = Outcome("success")
	OutcomeError   = Outcome("error")
	// OutcomeDenied is a write denied (or cancelled) WITHIN gateWrite's
	// own courtesy window (docs/adr/0032 §1) -- the denial is visible in
	// the same round trip the middleware wraps, so it's recorded
	// directly, never via the Parked* update path below.
	OutcomeDenied = Outcome("denied")
	// OutcomeParked is the interim state for a write still awaiting a
	// human decision past the courtesy window -- never a final value in
	// a resolved audit row, but a legitimate value to observe while the
	// write is genuinely still pending.
	OutcomeParked = Outcome("parked")
	// OutcomeParkedApproved/Denied/Expired render the contract's own
	// "parked->approved" / "parked->denied" / "parked->expired"
	// vocabulary in an ASCII-safe form (no arrow glyph in a DB column/
	// wire value) -- ResolveMCPWrite and the sweep's 24h expiry mutate a
	// pending OutcomeParked row to one of these three once the human (or
	// the clock) decides.
	OutcomeParkedApproved = Outcome("parked_approved")
	OutcomeParkedDenied   = Outcome("parked_denied")
	OutcomeParkedExpired  = Outcome("parked_expired")
	// OutcomeParkedCancelled is a fourth Parked* terminal value beyond
	// the three the design contract named -- added to preserve fidelity
	// with Mill's own four-way write lifecycle (docs/adr/0026's
	// cancel/withdraw verb, distinct from a human's denial) rather than
	// lossily collapsing a requester's own withdrawal into "denied".
	OutcomeParkedCancelled = Outcome("parked_cancelled")
)

// ErrorTextCap bounds how much of an error's text an audit row keeps --
// same 4KB cap and reasoning as aiclient's own error-truncation
// precedent (a raw stack trace or an oversized upstream error body must
// never make one row dominate the 10k-row retention window).
const ErrorTextCap = 4096

// TruncateError caps s to ErrorTextCap bytes, leaving it untouched when
// already within budget.
func TruncateError(s string) string {
	if len(s) <= ErrorTextCap {
		return s
	}
	return s[:ErrorTextCap]
}

// Record is one MCP call's full audit row. Args/results are
// DELIBERATELY never carried here -- ArgBytes is the size-only signal
// the design contract calls for (OTel GenAI/MCP semconv's own opt-in
// stance on payload capture); recording the payloads themselves is a
// named future decision, never a default (see the goal file's non-goals
// list).
type Record struct {
	ID int64
	// Timestamp is when the call completed (not when it started) -- the
	// same "record the outcome" timing every other audit-shaped record
	// in this codebase (MCPWriteRecord's own ResolvedAt) uses.
	Timestamp time.Time
	Direction Direction
	// SessionID mirrors OTel's mcp.session.id -- the MCP session (not a
	// Mill workflow-run id) this call happened on.
	SessionID string
	// MethodName mirrors OTel's mcp.method.name (e.g. "tools/call",
	// "tools/list", "resources/read") -- recorded for EVERY method the
	// middleware sees, not just tool calls.
	MethodName string
	// ToolName mirrors OTel's gen_ai.tool.name -- populated only when
	// MethodName is "tools/call"; empty for every other method.
	ToolName string
	// CallerIdentity is, server side, the connecting client's
	// initialize ClientInfo.Name/Version; client side, the owning
	// workflow step id or the agent-loop session id (see
	// WithCallerIdentity).
	CallerIdentity string
	Outcome        Outcome
	DurationMS     int64
	// ErrorText is capped via TruncateError before it ever reaches
	// storage.
	ErrorText string
	// ArgBytes is the request arguments' marshaled byte size ONLY --
	// never the arguments themselves.
	ArgBytes int64
	// ParkedWriteID links an OutcomeParked row to the MCPWriteRecord
	// (mcpsvc) it came from, so a later resolution can find and mutate
	// this exact row. Empty for every non-parked call. Mill-internal
	// linkage, not an OTel semconv field.
	ParkedWriteID string
}
