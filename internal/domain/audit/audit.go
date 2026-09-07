// Package audit holds the pure envelope type shared by every guarded
// surface's trail (goal 0351): mcpaudit and secretaudit adapters map
// their own producer-specific records onto Entry so every producer --
// MCP calls, secret reads, and the browser bridge -- writes through one
// store (internal/adapters/auditstore) and reads through one filtered
// API, rather than each producer minting its own table. Deliberately
// internal/domain (not internal/adapters): imported by BOTH the
// mcpaudit/secretaudit adapter packages AND internal/adapters/
// auditstore, and carries no persistence or state of its own
// (.claude/rules/backend.md's domain-stays-pure rule).
package audit

import "time"

// Kind discriminates which producer wrote one Entry -- the single
// column every audit-trail precedent researched for goal 0351 uses
// (Vault's "type", Kubernetes' "verb", CloudEvents' "type", Bitwarden's
// "type") instead of a per-producer table.
type Kind string

const (
	KindMCPCall       Kind = "mcp-call"
	KindSecretAccess  Kind = "secret-access"
	KindBridgeCommand Kind = "bridge-command"
)

// Actor is who/what performed the action. Correlation stays each
// producer's OWN existing ids (goal 0351 Decision 3) -- never a minted
// cross-producer id: RunID/WorkflowID/StepID when the action happened
// inside a workflow run, AgentSession for the agent loop's own session,
// Source for an external identity (an MCP client's ClientInfo name/
// version, or the browser bridge's "browser:<deviceId>"/
// "hook:<tokenId>"). Exactly one of StepID/AgentSession/Source is
// populated for a non-run actor; RunID/WorkflowID/StepID travel
// together when the action happened inside a workflow run.
type Actor struct {
	RunID        string
	WorkflowID   string
	StepID       string
	AgentSession string
	Source       string
}

// Target is what the action was performed on. Kind is a short noun
// ("tool", "secret"), ID its identifier, Label a display name
// denormalized AT THE TIME the row was written -- a later rename of the
// underlying thing must never rewrite history, the same convention
// secretaudit.Record.Label already followed before this envelope
// existed.
type Target struct {
	Kind  string
	ID    string
	Label string
}

// Entry is one row of the shared audit trail. Outcome stays the
// producer's own vocabulary (a plain string, never a shared enum) --
// mcpaudit's parked-write lifecycle and secretaudit's two-value
// read/error outcome are genuinely different shapes, and forcing them
// into one enum would either lose mcpaudit's parked states or grow a
// union no reader needs. FailureKind is populated only by producers
// that classify failures; empty for every other row. Attributes NEVER
// carries secret material -- every producer's own key set is checked
// against AllowedAttributes by ValidateAttributes before a row is ever
// written (goal 0351 Decision 1).
type Entry struct {
	ID          int64
	Timestamp   time.Time
	Kind        Kind
	Actor       Actor
	Action      string
	Target      Target
	Outcome     string
	FailureKind string
	Attributes  map[string]string
}
