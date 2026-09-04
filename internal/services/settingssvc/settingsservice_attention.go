package settingssvc

import (
	"fmt"
	"log/slog"
	"strconv"
	"strings"

	"github.com/alicoding/mill/internal/adapters/dockbadge"
	"github.com/alicoding/mill/internal/adapters/idletime"
	"github.com/alicoding/mill/internal/adapters/notify"
	"github.com/alicoding/mill/internal/adapters/windowing"
	"github.com/alicoding/mill/internal/domain/notification"
)

// idleTimeFn is idletime.Seconds's own swappable seam, same shape as
// dockBounceFn below -- a package var so a test can pin a specific
// idle reading (goal 0171's "focused-but-idle => notify" regression
// test) instead of depending on this machine's real HID idle counter.
var idleTimeFn = idletime.Seconds

// The away-user attention layer (docs/adr/0032 §3, sharpened by
// docs/goals/0023-attention-escalation.md item 2): the frontend already
// computes the total pending-decision count (guardrail parks + MCP
// writes, App.tsx's own reviewPendingCount effect) -- SetPendingBadge
// mirrors it to the dock icon, and NotifyPendingApproval fires an
// actionable OS notification (plus the floating approval prompt, item 1)
// for a new item once the presence gate below says the user is away.
//
// The presence gate moved BACKEND-side (isAway, below), correcting a
// real observed bug: a focused-but-unattended Mac previously suppressed
// the notification entirely, since presence was gated purely on
// document.hasFocus() (frontend-only, ADR-0032's original shape). The
// frontend now only supplies its own hasFocus() reading -- everything
// else about presence (idle time, the threshold) is resolved here.

// attentionIdleThresholdKey persists the idle-aware presence gate's own
// threshold (docs/goals/0023 item 2) -- same one-key-string shape every
// other small settings knob in this package already uses.
const attentionIdleThresholdKey = "settings-attention-idle-threshold-seconds"

// defaultAttentionIdleThresholdSeconds mirrors Teams' own away-status
// default (5 minutes) -- deliberately more conservative than Slack/
// Discord's own ~10-minute idle default, since Mill's notification is
// decision-blocking (a parked guardrail ask or MCP write), not merely a
// presence indicator for a chat.
const defaultAttentionIdleThresholdSeconds = 300

// GetAttentionIdleThreshold returns the configured idle-seconds
// threshold: the presence gate below treats the user as away once
// idletime.Seconds() reaches this, even while the window is focused --
// the fix for the focused-but-idle suppression case.
func (s *SettingsService) GetAttentionIdleThreshold() int {
	v, ok := s.store.Get(attentionIdleThresholdKey).(string)
	if !ok || v == "" {
		return defaultAttentionIdleThresholdSeconds
	}
	n, err := strconv.Atoi(v)
	if err != nil || n <= 0 {
		return defaultAttentionIdleThresholdSeconds
	}
	return n
}

// SetAttentionIdleThreshold persists seconds (a non-positive value
// resets to the default, mirroring a cleared Settings field rather than
// persisting a nonsensical threshold), returning the persist error --
// same reasoning as every other settings toggle in this package: a
// save that silently didn't take effect leaves the user believing a
// threshold applies when it doesn't.
func (s *SettingsService) SetAttentionIdleThreshold(seconds int) error {
	if seconds <= 0 {
		seconds = defaultAttentionIdleThresholdSeconds
	}
	if err := s.store.Set(attentionIdleThresholdKey, strconv.Itoa(seconds)); err != nil {
		return fmt.Errorf("save attention idle threshold: %w", err)
	}
	return nil
}

// IsAway is the ONE presence-gate decision point in the tree (docs/
// goals/0171): present = focused AND recently-active (idle below the
// configured threshold); away = anything else. Exported so every
// notification channel (settingsservice_notifychannels.go) and the
// browser tab (via this same method, bound as an RPC) share this one
// definition instead of each re-deriving their own -- the frontend's
// own focus-only predicate (goal 0132 slice A's shouldNotifyBrowserTab)
// existed only because there was no shared gate to call into; it is
// gone now that there is one. An idletime read error (server mode, or
// a real desktop failing to read the counter) FAILS TOWARD AWAY -- §8's
// fail-safe posture: a truly-away user missing a decision is the
// failure that matters, not a present user seeing one extra
// notification.
func (s *SettingsService) IsAway(focused bool) bool {
	if !focused {
		return true
	}
	idle, err := idleTimeFn()
	if err != nil {
		return true
	}
	return int(idle.Seconds()) >= s.GetAttentionIdleThreshold()
}

// SetPendingBadge applies count as the dock/taskbar badge -- best-effort
// (server mode's stub, or a desktop failure, must never break the
// caller), but a real failure is LOGGED, not swallowed: the first live
// test shipped with `_ =` here and the badge silently never appeared,
// leaving nothing anywhere to diagnose from (the exact silent-failure
// class §1's what-you-see-is-what-I-see thesis exists to prevent,
// applied to Mill's own plumbing).
func (s *SettingsService) SetPendingBadge(count int) {
	if err := dockBadgeSetFn(count); err != nil {
		slog.Warn("dock badge set failed", "count", count, "error", err)
	}
	if s.trayCountFn != nil {
		s.trayCountFn(count)
	}
}

// dockBadgeSetFn is SetPendingBadge's seam to the real dock adapter --
// the same package-var shape dockBounceFn uses, and for the same
// reason: the real call needs a live app (it hangs a headless test),
// so a test swaps this to observe the fan-out instead.
var dockBadgeSetFn = dockbadge.Set

// SetTrayCount wires the menu-bar label hook SetPendingBadge also
// drives (docs/goals/0189): the frontend aggregates the pending count
// ONCE and every OS chrome -- dock badge, tray label -- renders that
// same number. Injected from main.go (settingssvc never imports the
// application package), nil in server mode where no tray exists.
//
//wails:ignore
func (s *SettingsService) SetTrayCount(fn func(count int)) {
	s.trayCountFn = fn
}

// dockBounceFn is NotifyPendingApproval's one seam to the OS dock
// bounce: window.Flash maps to a single NSInformationalRequest on
// macOS (bounces once and self-completes; disabling is a no-op) and a
// taskbar flash on Windows. A package var so the away-branch wiring is
// unit-testable; the real dock behavior is OS-bound and stays a
// manual-only check (.claude/rules/testing.md).
var dockBounceFn = func(w *windowing.Window) {
	if w != nil {
		w.Flash(true)
	}
}

// notificationID encodes which pending-item KIND a delivered
// notification was for directly into its own ID (kind + ":" + id) --
// the simplest way for the OnNotificationResponse routing below to
// recover that later without a second lookup table, since a pending
// item's own id (an MCP write's uuid, or a run's own runID) never
// contains a colon.
func notificationID(kind, id string) string { return kind + ":" + id }

// approvalNotificationTitle is every approval channel's fixed title --
// pulled out to a const so the desktop banner (delivered through
// desktopBannerChannel) and this method agree on it by construction.
const approvalNotificationTitle = "Mill: approval needed"

// NotifyPendingApproval publishes a durable notification for a new
// pending item (docs/goals/0171) and shows the floating approval
// prompt, but ONLY when IsAway(focused) says the user is away -- the
// single decision point every surface shares, so "notify" and "show
// the floating prompt" can never disagree about presence. focused is
// the caller's own document.hasFocus() reading (App.tsx) -- only the
// browser context knows that; everything else about presence (idle
// time, the threshold) is resolved in IsAway.
//
// The desktop banner and dock bounce below now run through Publish's
// channel registry (settingsservice_notifychannels.go) rather than
// calling notify.Send*/dockBounceFn directly -- same observable calls,
// same away verdict, just expressed as registered channels so a future
// channel is one new struct, not a new branch here. kind "mcp-write"
// still gets Approve/Deny action buttons resolving via ResolveMCPWrite
// (desktopBannerChannel.Deliver's own branch); any other kind gets a
// plain notification whose default click shows+focuses the main window
// -- typed input may be required to resolve those, so blind approval
// from a notification isn't offered.
func (s *SettingsService) NotifyPendingApproval(id, description, kind string, focused bool) error {
	if s.notificationSvc != nil {
		evt := notification.Event{
			Type: kind, Title: approvalNotificationTitle, Body: description,
			DedupeKey: id, SourceRef: id, Focused: focused,
		}
		if _, err := s.notificationSvc.Publish(evt); err != nil {
			slog.Error("publish pending-approval notification", "id", id, "error", err)
		}
	}
	if !s.IsAway(focused) {
		// Present: the in-app banner/Review row/canvas already show
		// this live -- notifying too would be double-noise (§1's
		// not-harder-than-baseline lock).
		return nil
	}
	// Both fire on the same away verdict (docs/goals/0023 item 1): the
	// notification for notification-center persistence (delivered
	// above via Publish's channel fan-out), the floating prompt for
	// on-screen visibility -- neither replaces the other.
	s.showApprovalPrompt(id)
	return nil
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
			if err := s.ResolveMCPWrite(id, r.ActionIdentifier == notify.ApproveActionID); err != nil {
				// Same reasoning as SetPendingBadge above: a notification
				// Approve/Deny tap has no UI of its own to surface an
				// error through (the user already dismissed the
				// notification), so this is the only place a failure
				// here is diagnosable at all (docs/goals/0025 item 6).
				slog.Error("failed to resolve MCP write from notification action", "id", id, "approve", r.ActionIdentifier == notify.ApproveActionID, "error", err)
			}
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
