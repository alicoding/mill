package settingssvc

import (
	"github.com/alicoding/mill/internal/adapters/buildinfo"
	"github.com/alicoding/mill/internal/adapters/notify"
	"github.com/alicoding/mill/internal/domain/notification"
)

// The notification spine's three migrated channels (docs/goals/0171):
// each wraps the exact adapter call NotifyPendingApproval always made
// (notify.SendPlain/SendActionable, dockBounceFn) or the exact gate
// the browser-tab hook always evaluated (slice A's server-mode +
// presence check), now expressed as a notification.Channel so a
// future channel is a new struct + one RegisterChannel call rather
// than a new branch inside NotifyPendingApproval. All three share
// IsAway as their presence gate -- ONE decision point, not a
// per-channel reimplementation.

// desktopBannerChannel delivers the native OS notification (docs/adr/
// 0032 §3): actionable (Approve/Deny) for an MCP write, plain
// (opens/focuses the window) for anything else -- the same kind-based
// branch NotifyPendingApproval always ran.
type desktopBannerChannel struct{ s *SettingsService }

func (desktopBannerChannel) Name() string { return "desktop-banner" }

func (c desktopBannerChannel) ShouldDeliver(evt notification.Event) bool {
	return c.s.IsAway(evt.Focused)
}

func (desktopBannerChannel) Deliver(evt notification.Event, _ notification.Record) error {
	notifID := notificationID(evt.Type, evt.SourceRef)
	if evt.Type == "mcp-write" {
		return notify.SendActionable(notifID, evt.Title, evt.Body)
	}
	return notify.SendPlain(notifID, evt.Title, evt.Body)
}

// dockBounceChannel delivers the one-shot dock/taskbar bounce
// (dockBounceFn, settingsservice_attention.go) -- distinct from the
// continuous pending-count badge (SetPendingBadge), which mirrors a
// live count unconditionally rather than delivering one discrete
// notification, so it stays outside this registry.
type dockBounceChannel struct{ s *SettingsService }

func (dockBounceChannel) Name() string { return "dock-bounce" }

func (c dockBounceChannel) ShouldDeliver(evt notification.Event) bool {
	return c.s.IsAway(evt.Focused)
}

func (c dockBounceChannel) Deliver(_ notification.Event, _ notification.Record) error {
	c.s.mu.Lock()
	w := c.s.window
	c.s.mu.Unlock()
	dockBounceFn(w)
	return nil
}

// browserTabChannel decides whether a connected browser tab should
// raise its own Notifications-API banner (goal 0132 slice A) -- server
// mode only, since a desktop build already shows the native banner
// above and the two must never double-fire. Deliver is deliberately a
// no-op: the actual `new Notification(...)` call can only happen in
// the browser's own JS runtime, which learns whether THIS channel
// participated from Publish's own response (PublishResult.Delivered),
// never from a server-side push into an already-loaded tab.
type browserTabChannel struct{ s *SettingsService }

func (browserTabChannel) Name() string { return "browser-tab" }

func (c browserTabChannel) ShouldDeliver(evt notification.Event) bool {
	return buildinfo.Read().Server && c.s.IsAway(evt.Focused)
}

func (browserTabChannel) Deliver(notification.Event, notification.Record) error { return nil }

// NotificationChannels returns this service's three delivery channels,
// registered into a NotificationService once at wiring time
// (main.go): notificationService.RegisterChannel called once per
// entry here. Exported for wiring only, never a frontend RPC.
//
//wails:ignore
func (s *SettingsService) NotificationChannels() []notification.Channel {
	return []notification.Channel{
		desktopBannerChannel{s: s},
		dockBounceChannel{s: s},
		browserTabChannel{s: s},
	}
}
