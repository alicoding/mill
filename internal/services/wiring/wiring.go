// Package wiring is composition-root code split out of main.go (the
// repo root keeps exactly one Go file): the cross-service seam
// adapters that connect one bounded context's injected-func seams to
// another's exported readers. It may import multiple service packages
// -- it IS the composition root's own code, not a service -- while the
// services themselves stay import-free of each other.
package wiring

import (
	"errors"
	"log"
	"log/slog"
	"os"

	"github.com/alicoding/mill/internal/adapters/buildinfo"
	"github.com/alicoding/mill/internal/adapters/credential"
	"github.com/alicoding/mill/internal/adapters/mcpclient"
	"github.com/alicoding/mill/internal/adapters/notify"
	"github.com/alicoding/mill/internal/adapters/secretvault"
	"github.com/alicoding/mill/internal/adapters/settings"
	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/alicoding/mill/internal/domain/notification"
	"github.com/alicoding/mill/internal/domain/typedfield"
	"github.com/alicoding/mill/internal/services/atlassvc"
	"github.com/alicoding/mill/internal/services/compositionsvc"
	"github.com/alicoding/mill/internal/services/configuresvc"
	"github.com/alicoding/mill/internal/services/executionsvc"
	"github.com/alicoding/mill/internal/services/mcpauditsvc"
	"github.com/alicoding/mill/internal/services/notificationsvc"
	"github.com/alicoding/mill/internal/services/remoteauthsvc"
	"github.com/alicoding/mill/internal/services/secretsvc"
	"github.com/alicoding/mill/internal/services/settingssvc"
	"github.com/alicoding/mill/internal/services/triggersvc"
)

// WireAtlasProjections connects AtlasService's recognition (goal 0126)
// and List-projection (goal 0105) seams to Configure's and
// Composition's exported readers, adapting types at the boundary.
// WireValidationSeams connects graph validation's Configure-side
// checks (goal 0127 slice 3: the credential-presence gap).
func WireValidationSeams(cfg *configuresvc.ConfigureService) {
	composition.SetCredentialGapCheck(cfg.RequestCredentialGap)
}

func WireAtlasProjections(atlas *atlassvc.AtlasService, cfg *configuresvc.ConfigureService, comp *compositionsvc.CompositionService) {
	atlas.WireSourceRecognition(
		func() []atlassvc.RecognizedIntegration {
			hosts := cfg.IntegrationHosts()
			out := make([]atlassvc.RecognizedIntegration, 0, len(hosts))
			for _, h := range hosts {
				out = append(out, atlassvc.RecognizedIntegration{RequestID: h.ID, Label: h.Label, Host: h.Host})
			}
			return out
		},
		func(requestID string) []atlassvc.OfferedAction {
			offers := comp.WorkflowsOfferingRequest(requestID)
			out := make([]atlassvc.OfferedAction, 0, len(offers))
			for _, o := range offers {
				out = append(out, atlassvc.OfferedAction{WorkflowID: o.ID, Label: o.Label})
			}
			return out
		},
	)
	atlas.WireListProjection(func(listID string) (atlassvc.ListProjection, bool) {
		label, cols, rows, ok := cfg.ListProjectionData(listID)
		if !ok {
			return atlassvc.ListProjection{}, false
		}
		proj := atlassvc.ListProjection{ListID: listID, Label: label}
		for _, c := range cols {
			proj.Columns = append(proj.Columns, atlassvc.ProjectionColumn{Key: c.Key, Label: c.Label, Type: string(c.Type), Options: c.Options, OptionColors: c.OptionColors, Deprecated: c.Deprecated})
		}
		for _, r := range rows {
			proj.Rows = append(proj.Rows, atlassvc.ProjectionRow{ID: r.ID, Status: r.Status, Values: r.Values})
		}
		return proj, true
	})
}

// WirePasteConversion connects the board's paste-understanding table
// path (goal 0138) to Configure's own List writes.
func WirePasteConversion(atlas *atlassvc.AtlasService, cfg *configuresvc.ConfigureService) {
	atlas.WirePasteListWrites(
		func(label string, columns []typedfield.Field) (string, error) {
			l, err := cfg.CreateList(label, "", columns)
			return l.ID, err
		},
		func(listID string, values map[string]string) error {
			_, err := cfg.AddListRow(listID, values)
			return err
		},
	)
}

// WireAtlasStorageDirs resolves and wires every Mill-owned directory
// AtlasService writes into on its own -- the share model's mirror root
// (goal 0063/0067) and the image tool's captures folder (goal 0169
// slice 2) -- split out of main.go at the 500-line limit, same shape
// every other Wire* function here already takes.
func WireAtlasStorageDirs(atlas *atlassvc.AtlasService) {
	atlas.SetMirrorsDir(atlassvc.DefaultMirrorsDir(os.Getenv("MILL_ATLAS_MIRRORS_DIR")))
	atlas.SetCapturesDir(atlassvc.DefaultCapturesDir(os.Getenv("MILL_ATLAS_CAPTURES_DIR")))
}

// WireUpdateEvents connects the updater's once-per-version discovery
// (goal 0146) to the trigger plane's update-available system event --
// the composed notification workflow is the consumer, never a
// private send path (ADR-0035).
func WireUpdateEvents(settings *settingssvc.SettingsService, triggers *triggersvc.TriggerService) {
	settings.SetUpdateEventSink(func(version, channel string) {
		triggers.DispatchSystemEvent(executionsvc.SystemEvent{
			Event:   executionsvc.SystemEventUpdateAvailable,
			Version: version,
			Channel: channel,
		})
	})
}

// WireNotify connects composition's apply-notify seam to the OS
// notification adapter (goal 0114). Server mode's adapter refuses by
// design (ErrUnsupportedInServerMode) -- that maps to success here: the
// notification is best-effort delivery, and "unsupported on this
// build" must not fail a workflow whose real work already succeeded.
// Every other error propagates.
func WireNotify() {
	composition.SetNotifier(func(title, body string) error {
		err := notify.SendPlain("mill-workflow-notify", title, body)
		if errors.Is(err, notify.ErrUnsupportedInServerMode) {
			return nil
		}
		return err
	})
}

// WireMCPAudit constructs the MCP call audit trail (goal 0159 slice 1)
// against dbPath and wires mcpclient's package-level sending middleware
// -- pulled out of main.go's own construction flow to keep that file
// under the 500-line limit, the same reason this package exists.
// Exits the process on failure: dbPath's file is already proven
// writable by DBOS's own successful open before main.go ever calls
// this, so a failure here means a real environment problem, matching
// executionsvc.NewExecutionService's own fatal-on-construction-failure
// posture.
func WireMCPAudit(dbPath string, logger *slog.Logger) *mcpauditsvc.MCPAuditService {
	svc, err := mcpauditsvc.New(dbPath, logger)
	if err != nil {
		log.Fatal(err)
	}
	mcpclient.SetSendingMiddleware(svc.ClientMiddleware())
	return svc
}

// WireRemoteAuth constructs docs/goals/0132-remote-access.md SLICE 1's
// auth gate. Its result feeds two places in main.go: the Services
// list (so Settings > Remote access can call it) and
// application.Options.Assets.Middleware (so it gates every request the
// AssetServer serves) -- pulled out here for the same 500-line reason
// WireMCPAudit above is. BootstrapPairingCode runs immediately after
// construction, gated on the build-tag-derived server flag: SLICE 1b's
// fix for the bootstrap deadlock a non-loopback-bound server instance
// hits otherwise (see that method's own doc comment).
func WireRemoteAuth(store settings.Store, logger *slog.Logger) *remoteauthsvc.RemoteAuthService {
	svc := remoteauthsvc.New(store, logger)
	svc.BootstrapPairingCode(buildinfo.Read().Server)
	return svc
}

// WireSecrets constructs the vault (goal 0185) at vaultPath, sharing
// credentials with configuresvc's own HTTPRequest/AIProvider secrets --
// same OS keychain, its own well-known id. Pulled out of main.go for the
// same 500-line reason WireRemoteAuth above is; vaultPath's own
// MILL_SECRETS_PATH-override-or-default resolution stays in main.go
// (depguard: this package doesn't import wails/v3/pkg/application).
func WireSecrets(vaultPath string, credentials credential.Store) *secretsvc.SecretService {
	return secretsvc.NewSecretService(secretvault.New(vaultPath), credentials)
}

// WireSecretRedaction wires composition's mcp-tool-call node error path
// to secretService's own known-secret scrubber (goal 0185 S4) -- a
// server launched with an injected vault secret could echo it back in
// its own failure text.
func WireSecretRedaction(secretService *secretsvc.SecretService) {
	composition.SetSecretRedactor(secretService.RedactKnownSecrets)
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
		title, body = "Update available", "Version " + ev.Version + " is ready to install."
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
