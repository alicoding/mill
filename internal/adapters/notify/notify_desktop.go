//go:build !server

package notify

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/services/notifications"
)

// svc is Wails3's own package-level singleton (notifications.New()
// itself uses sync.Once and returns the same instance every call) --
// there is exactly one OS notification center per process, so wrapping
// it in a package var here matches the underlying API's own shape
// rather than fighting it.
var svc = notifications.New()

// Start performs the real Startup handshake (bundle-ID check +
// UNUserNotificationCenter delegate init on macOS) and registers the
// Approve/Deny category, once, after the native app exists -- must run
// from ApplicationStarted, the same ordering main.go already gives
// RestoreSummonHotkey/ReleaseMenuAccelerators, not from
// ServiceStartup (this isn't registered as a Wails Service; nothing
// calls that automatically). A failure here (most commonly: a bare dev
// binary with no real bundle ID) degrades to a returned error the
// caller logs and continues past -- never fatal, matching
// launchatlogin.ErrNotAppBundle's own degrade-gracefully pattern.
func Start() error {
	if err := svc.ServiceStartup(context.Background(), application.ServiceOptions{}); err != nil {
		return fmt.Errorf("notifications startup: %w", err)
	}

	// Alert-style authorization (docs/goals/0023-attention-escalation.md
	// item 3): the pinned notifications API's own
	// RequestNotificationAuthorization has no per-type parameter to
	// request Alert *specifically* -- checked directly against the
	// native implementation (notifications_darwin.m): it always
	// requests UNAuthorizationOptionAlert | Sound | Badge together as
	// one fixed bundle, with no Go-level option to narrow that. So
	// there is nothing to configure beyond calling it -- Alert is
	// already included, unconditionally, in the only authorization
	// request this SDK version can make. Backgrounded: this can block
	// on the native permission dialog (up to its own internal 3-minute
	// timeout) and app startup must not stall on the user's decision,
	// same "never fatal, log and continue" posture as the rest of this
	// package. This was previously never called at all -- a real,
	// closeable gap (Send* would silently never actually alert without
	// it ever having been requested).
	go func() {
		if _, err := svc.RequestNotificationAuthorization(); err != nil {
			slog.Warn("notification authorization request failed", "error", err)
		}
	}()

	return svc.RegisterNotificationCategory(notifications.NotificationCategory{
		ID: CategoryMCPWrite,
		Actions: []notifications.NotificationAction{
			{ID: ApproveActionID, Title: "Approve"},
			{ID: DenyActionID, Title: "Deny"},
		},
	})
}

// OnResponse wires callback to fire whenever the user interacts with a
// delivered notification (an action button, or the default click) --
// only one callback may be registered at a time (the underlying SDK's
// own constraint), so this is called exactly once, from the same
// startup path as Start.
func OnResponse(callback func(Response)) {
	svc.OnNotificationResponse(func(result notifications.NotificationResult) {
		if result.Error != nil {
			return
		}
		callback(Response{ID: result.Response.ID, ActionIdentifier: result.Response.ActionIdentifier})
	})
}

// SendActionable delivers a notification carrying the Approve/Deny
// actions (a pending MCP write, docs/adr/0032 §3).
func SendActionable(id, title, body string) error {
	return svc.SendNotificationWithActions(notifications.NotificationOptions{
		ID: id, Title: title, Body: body, CategoryID: CategoryMCPWrite,
	})
}

// SendPlain delivers a plain notification with no action buttons (a
// guardrail/human-review park) -- its default click still routes
// through OnResponse with ActionIdentifier == DefaultActionID.
func SendPlain(id, title, body string) error {
	return svc.SendNotification(notifications.NotificationOptions{ID: id, Title: title, Body: body})
}
