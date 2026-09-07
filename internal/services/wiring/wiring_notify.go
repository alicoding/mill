// The notification spine's share of the composition root (the 500-line
// split from wiring.go): every seam that lands on notificationsvc's
// Publish -- apply-notify's notifier, the delivery channels (desktop,
// phone), and system events -- so the fan-out's whole wiring lives in
// one file.

package wiring

import (
	"log/slog"

	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/alicoding/mill/internal/domain/notification"
	"github.com/alicoding/mill/internal/services/executionsvc"
	"github.com/alicoding/mill/internal/services/notificationsvc"
	"github.com/alicoding/mill/internal/services/remoteauthsvc"
	"github.com/alicoding/mill/internal/services/settingssvc"
	"github.com/alicoding/mill/internal/services/triggersvc"
	"github.com/google/uuid"
)

// WireNotify connects composition's apply-notify seam to the
// notification spine (goal 0368's class fix): every apply-notify run
// publishes one Event, so the workflow's notification reaches every
// registered channel -- desktop banner, dock bounce, browser tab and
// any paired phone -- instead of only the OS banner the direct
// notify.SendPlain call used to produce. The desktop-banner channel
// (settingsservice_notifychannels.go) wraps the same notify.SendPlain
// adapter, gated on the away predicate every spine consumer already
// shares; delivery is best-effort by Publish's own contract (a channel
// failure, including server mode's banner refusal, logs and never
// fails the run). DedupeKey is run-scoped (one record per run); runID
// is "" for a run context the notifier can't resolve, which falls back
// to a uuid so Publish's required-key check still holds.
func WireNotify(notif *notificationsvc.NotificationService) {
	composition.SetNotifier(func(title, body, runID string) error {
		dedupeKey := "workflow-notify:" + runID
		if runID == "" {
			dedupeKey = "workflow-notify:" + uuid.NewString()
		}
		_, err := notif.Publish(notification.Event{
			Type:      "workflow-notify",
			Title:     title,
			Body:      body,
			DedupeKey: dedupeKey,
			SourceRef: runID,
		})
		return err
	})
}

// WireNotificationChannels registers settingsService's three delivery
// channels (desktop banner, dock bounce, browser tab -- docs/goals/
// 0171-notification-spine.md) into notif, and late-binds notif back
// into settingsService so NotifyPendingApproval can publish through
// it. Pulled out of main.go for the same 500-line reason WireMCPAudit
// above is.
func WireNotificationChannels(settingsService *settingssvc.SettingsService, notif *notificationsvc.NotificationService) {
	for _, ch := range settingsService.NotificationChannels() {
		notif.RegisterChannel(ch)
	}
	settingsService.SetNotificationService(notif)
}

// WirePhoneChannel registers remoteAuth's phone channel (docs/goals/
// 0132-remote-access.md SLICE B) into notif -- the ntfy protocol's
// Deliver reaches every currently-paired device's topic in one call,
// so this is a single RegisterChannel, the same shape as
// WireNotificationChannels above.
func WirePhoneChannel(remoteAuth *remoteauthsvc.RemoteAuthService, notif *notificationsvc.NotificationService) {
	notif.RegisterChannel(remoteAuth.NotificationChannel())
}

// WireSystemEventNotifications adds the notification spine (docs/goals/
// 0171) as a SECOND consumer of the existing system-event sink,
// alongside triggers.DispatchSystemEvent -- ExecutionService's producer
// side (executionservice_systemevent.go) is untouched; this only
// changes what main.go passes to SetSystemEventSink, from the trigger
// dispatch alone to the trigger dispatch plus a durable-notification
// publish. The two run-completed/run-failed/run-cancelled/
// update-available kinds this closes the silent-loss gap for can fire
// with no window open at all (a scheduled workflow finishing
// unattended); decision-parked is deliberately excluded, since it
// already publishes through NotifyPendingApproval
// (settingsservice_attention.go) -- routing it through here too would
// just be a second producer racing for the same DedupeKey.
func WireSystemEventNotifications(exec *executionsvc.ExecutionService, triggers *triggersvc.TriggerService, notif *notificationsvc.NotificationService) {
	exec.SetSystemEventSink(func(ev executionsvc.SystemEvent) {
		triggers.DispatchSystemEvent(ev)
		publishSystemEventNotification(notif, ev)
	})
}

// publishSystemEventNotification maps one SystemEvent to the
// notification spine's Event shape -- copy states what happened, never
// the run's own payload (ux-writing.md: says what waits, not the data
// being acted on).
func publishSystemEventNotification(notif *notificationsvc.NotificationService, ev executionsvc.SystemEvent) {
	var title, body string
	switch ev.Event {
	case executionsvc.SystemEventRunCompleted:
		title, body = "Workflow finished", ev.WorkflowLabel+" finished running."
	case executionsvc.SystemEventRunFailed:
		title, body = "Workflow failed", ev.WorkflowLabel+" hit an error and stopped."
	case executionsvc.SystemEventRunCancelled:
		title, body = "Workflow cancelled", ev.WorkflowLabel+" was cancelled."
	case executionsvc.SystemEventUpdateAvailable:
		title, body = "Update available", "Version "+ev.Version+" is ready to install."
	default:
		return
	}
	evt := notification.Event{
		Type: string(ev.Event), Title: title, Body: body,
		DedupeKey: string(ev.Event) + ":" + ev.RunID + ev.Version,
		SourceRef: ev.RunID,
	}
	if _, err := notif.Publish(evt); err != nil {
		slog.Warn("publish system-event notification", "event", ev.Event, "error", err)
	}
}
