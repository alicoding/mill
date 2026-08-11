package settingssvc

import (
	"strings"

	"github.com/alicoding/mill/internal/adapters/dockbadge"
	"github.com/alicoding/mill/internal/adapters/notify"
)

// The away-user attention layer (docs/adr/0032 §3): the frontend
// already computes the total pending-decision count (guardrail parks +
// MCP writes, App.tsx's own reviewPendingCount effect) -- SetPendingBadge
// mirrors it to the dock icon, and NotifyPendingApproval fires an
// actionable OS notification for a new item while the window is
// unfocused (the document.hasFocus() gate lives frontend-side, since
// only the browser context knows that).

// SetPendingBadge applies count as the dock/taskbar badge -- a no-op
// error in server mode (dockbadge_server.go), silently swallowed here
// same as every other best-effort desktop-only affordance in this
// service (the tray icon, the summon hotkey).
func (s *SettingsService) SetPendingBadge(count int) {
	_ = dockbadge.Set(count)
}

// notificationID encodes which pending-item KIND a delivered
// notification was for directly into its own ID (kind + ":" + id) --
// the simplest way for the OnNotificationResponse routing below to
// recover that later without a second lookup table, since a pending
// item's own id (an MCP write's uuid, or a run's own runID) never
// contains a colon.
func notificationID(kind, id string) string { return kind + ":" + id }

// NotifyPendingApproval sends an actionable OS notification for a new
// pending item (docs/adr/0032 §3). kind "mcp-write" gets Approve/Deny
// action buttons resolving directly via ResolveMCPWrite; any other kind
// (a guardrail/human-review park) gets a plain notification whose
// default click shows+focuses the window instead -- typed input may be
// required to resolve those, so blind approval from a notification
// isn't offered.
func (s *SettingsService) NotifyPendingApproval(id, description, kind string) error {
	const title = "Mill: approval needed"
	notifID := notificationID(kind, id)
	if kind == "mcp-write" {
		return notify.SendActionable(notifID, title, description)
	}
	return notify.SendPlain(notifID, title, description)
}

// SetupAwayAttention registers the notification category and wires the
// user's response back to a decision -- called once from main.go's
// ApplicationStarted handler, the same startup ordering
// RestoreSummonHotkey/ReleaseMenuAccelerators already use (the native
// notification-center delegate needs the app to actually exist first).
// A Start failure (most commonly a bare dev binary with no real bundle
// ID, or server mode) degrades to a returned error the caller logs and
// continues past -- never fatal, matching launchatlogin.ErrNotAppBundle's
// own pattern.
//
//wails:ignore
func (s *SettingsService) SetupAwayAttention() error {
	if err := notify.Start(); err != nil {
		return err
	}
	notify.OnResponse(func(r notify.Response) {
		kind, id, ok := strings.Cut(r.ID, ":")
		if !ok {
			return
		}
		if kind == "mcp-write" && (r.ActionIdentifier == notify.ApproveActionID || r.ActionIdentifier == notify.DenyActionID) {
			_ = s.ResolveMCPWrite(id, r.ActionIdentifier == notify.ApproveActionID)
			return
		}
		// A guardrail/human-review park's action button, or any
		// default-click -- typed input may be required to actually
		// resolve one of these, so the notification only ever opens
		// the window rather than guessing an approve/deny.
		s.ShowWindow()
	})
	return nil
}
