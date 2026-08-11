//go:build !server

package notify

import (
	"context"
	"fmt"

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
