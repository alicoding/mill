// Package notify wraps Wails3's own notifications.NotificationService
// behind Mill's own small names -- the away-user attention layer
// (docs/adr/0032 §3): an actionable OS notification for a pending MCP
// write (Approve/Deny buttons resolving directly), a plain one for a
// guardrail/human-review park (opens/focuses the window instead --
// typed input may be required, so blind approval from a notification
// isn't offered).
//
// Split by !server/server build tag, same shape and reasoning as
// internal/adapters/hotkey and internal/adapters/launchatlogin: server
// mode has no OS notification center to register against regardless of
// platform (docs/SPEC.md §1.3).
package notify

// Action IDs for the MCP-write actionable category (docs/adr/0032 §3).
const (
	ApproveActionID = "approve"
	DenyActionID    = "deny"
	// CategoryMCPWrite groups the two actions above under one reusable
	// category, registered once at startup (Start).
	CategoryMCPWrite = "mill-mcp-write" //nolint:gosec // an OS-notification category name, not a credential (G101 false positive)
	// DefaultActionID mirrors notifications.DefaultActionIdentifier --
	// the ActionIdentifier a Response carries when the user clicked the
	// notification body itself, not an action button. Hardcoded rather
	// than imported so this shared file has no wails dependency the
	// server build would then need to no-op around.
	DefaultActionID = "DEFAULT_ACTION"
)

// Response is what the user did with a delivered notification -- the
// two fields Mill's own routing needs, narrower than
// notifications.NotificationResponse so callers outside this package
// never need the underlying wails type.
type Response struct {
	ID               string
	ActionIdentifier string
}
