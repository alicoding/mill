package settingssvc

import (
	"fmt"
	"log/slog"
	"strconv"
	"strings"

	"github.com/alicoding/mill/internal/adapters/dockbadge"
	"github.com/alicoding/mill/internal/adapters/idletime"
	"github.com/alicoding/mill/internal/adapters/notify"
	"github.com/wailsapp/wails/v3/pkg/application"
)

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

// isAway is the ONE presence-gate decision point NotifyPendingApproval
// uses for both the OS notification and the floating approval prompt
// (docs/goals/0023 items 1+2): present = focused AND recently-active
// (idle below the configured threshold); away = anything else. An
// idletime read error (server mode, or a real desktop failing to read
// the counter) FAILS TOWARD AWAY -- §8's fail-safe posture: a truly-
// away user missing a decision is the failure that matters, not a
// present user seeing one extra notification.
func (s *SettingsService) isAway(focused bool) bool {
	if !focused {
		return true
	}
	idle, err := idletime.Seconds()
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
	if err := dockbadge.Set(count); err != nil {
		slog.Warn("dock badge set failed", "count", count, "error", err)
	}
}

// dockBounceFn is NotifyPendingApproval's one seam to the OS dock
// bounce: window.Flash maps to a single NSInformationalRequest on
// macOS (bounces once and self-completes; disabling is a no-op) and a
// taskbar flash on Windows. A package var so the away-branch wiring is
// unit-testable; the real dock behavior is OS-bound and stays a
// manual-only check (.claude/rules/testing.md).
var dockBounceFn = func(w *application.WebviewWindow) {
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

// NotifyPendingApproval sends an actionable OS notification AND shows
// the floating approval prompt (docs/goals/0023 item 1) for a new
// pending item (docs/adr/0032 §3), but ONLY when isAway(focused) says
// the user is away -- the single decision point both surfaces share, so
// "notify" and "show the floating prompt" can never disagree about
// presence. focused is the caller's own document.hasFocus() reading
// (App.tsx) -- only the browser context knows that; everything else
// about presence (idle time, the threshold) is resolved in isAway.
//
// kind "mcp-write" gets Approve/Deny action buttons resolving directly
// via ResolveMCPWrite; any other kind (a guardrail/human-review park)
// gets a plain notification whose default click shows+focuses the main
// window instead -- typed input may be required to resolve those, so
// blind approval from a notification isn't offered.
func (s *SettingsService) NotifyPendingApproval(id, description, kind string, focused bool) error {
	if !s.isAway(focused) {
		// Present: the in-app banner/Review row/canvas already show
		// this live -- notifying too would be double-noise (§1's
		// not-harder-than-baseline lock).
		return nil
	}
	// One-shot dock bounce, same kernel attention-layer class as the
	// dock badge (docs/adr/0032 §3, ADR-0035's kernel/composition
	// boundary): an away user gets a single informational bounce per
	// newly-parked item, alongside the notification and the floating
	// prompt -- never a repeating/critical request.
	s.mu.Lock()
	w := s.window
	s.mu.Unlock()
	dockBounceFn(w)

	const title = "Mill: approval needed"
	notifID := notificationID(kind, id)
	var sendErr error
	if kind == "mcp-write" {
		sendErr = notify.SendActionable(notifID, title, description)
	} else {
		sendErr = notify.SendPlain(notifID, title, description)
	}
	// Both fire on the same away verdict (docs/goals/0023 item 1): the
	// notification for notification-center persistence, the floating
	// prompt for on-screen visibility -- neither replaces the other.
	s.showApprovalPrompt()
	return sendErr
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
