// Package wiring is composition-root code split out of main.go (the
// repo root keeps exactly one Go file): the cross-service seam
// adapters that connect one bounded context's injected-func seams to
// another's exported readers. It may import multiple service packages
// -- it IS the composition root's own code, not a service -- while the
// services themselves stay import-free of each other.
package wiring

import (
	"context"
	"errors"
	atlasdomain "github.com/alicoding/mill/internal/domain/atlas"
	"io/fs"
	"log"
	"log/slog"
	"os"
	"strings"
	"time"

	"github.com/alicoding/mill/internal/adapters/buildinfo"
	"github.com/alicoding/mill/internal/adapters/mcpclient"
	"github.com/alicoding/mill/internal/adapters/notify"
	"github.com/alicoding/mill/internal/adapters/secretaudit"
	"github.com/alicoding/mill/internal/adapters/settings"
	"github.com/alicoding/mill/internal/domain/browserbridge"
	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/alicoding/mill/internal/domain/notification"
	"github.com/alicoding/mill/internal/domain/typedfield"
	"github.com/alicoding/mill/internal/services/atlassvc"
	"github.com/alicoding/mill/internal/services/backupsvc"
	"github.com/alicoding/mill/internal/services/bridgesvc"
	"github.com/alicoding/mill/internal/services/clipboardhistorysvc"
	"github.com/alicoding/mill/internal/services/codeloopsvc"
	"github.com/alicoding/mill/internal/services/compositionsvc"
	"github.com/alicoding/mill/internal/services/configuresvc"
	"github.com/alicoding/mill/internal/services/executionsvc"
	"github.com/alicoding/mill/internal/services/guardrailsvc"
	"github.com/alicoding/mill/internal/services/mcpauditsvc"
	"github.com/alicoding/mill/internal/services/mcpsvc"
	"github.com/alicoding/mill/internal/services/notificationsvc"
	"github.com/alicoding/mill/internal/services/pluginsvc"
	"github.com/alicoding/mill/internal/services/remoteauthsvc"
	"github.com/alicoding/mill/internal/services/secretsvc"
	"github.com/alicoding/mill/internal/services/settingssvc"
	"github.com/alicoding/mill/internal/services/triggersvc"
)

// shutdownTimeout bounds every step of RunShutdown below that talks to
// something with its own graceful-stop sequence -- the app is already
// tearing down by the time any of these run, so no single step may
// hang the process exit indefinitely.
const shutdownTimeout = 5 * time.Second

// RunShutdown runs every best-effort teardown step main.go's own
// post-app.Run() sequence needs, in order, logging (never failing
// loudly) on each step's own error -- a step's failure must never
// block the rest, since the process is exiting either way.
func RunShutdown(logger *slog.Logger, executionService *executionsvc.ExecutionService, backupService *backupsvc.BackupService, millMCPService *mcpsvc.MillMCPService, mcpAuditService *mcpauditsvc.MCPAuditService, atlasService *atlassvc.AtlasService, secretService *secretsvc.SecretService) {
	// Flush any in-flight step checkpoints before the process actually
	// exits.
	if err := executionService.Shutdown(shutdownTimeout); err != nil {
		logger.Error("execution runtime shutdown", "error", err)
	}
	// docs/goals/0065 item 4: one last snapshot on a clean shutdown,
	// skipped if a recent one already ran.
	if err := backupService.BackupOnCleanShutdown(); err != nil {
		logger.Error("clean-shutdown backup", "error", err)
	}
	shutdownCtx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
	defer cancel()
	if err := millMCPService.Shutdown(shutdownCtx); err != nil {
		logger.Error("mill MCP server shutdown", "error", err)
	}
	if err := mcpAuditService.Close(); err != nil {
		logger.Error("mcp audit service shutdown", "error", err)
	}
	// goal 0203 S3: secretService's own audit store, paired with
	// mcpAuditService's above -- WireAuditTrails opened both against the
	// same dbPath, so they close together here too.
	if err := secretService.CloseAudit(); err != nil {
		logger.Error("secret audit service shutdown", "error", err)
	}
	// No watcher goroutine outlives the process (goal 0194's live
	// round-trip slice).
	atlasService.CloseAllMirrorWatches()
}

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

// WireConfigureSeams bundles the seams that need both Atlas and
// Configure: the board's paste-understanding List writes, the plugin
// content-write door, and the List row doors' undo journal -- one line
// at the composition root.
func WireConfigureSeams(atlas *atlassvc.AtlasService, cfg *configuresvc.ConfigureService, plugins *pluginsvc.PluginService) {
	WirePasteConversion(atlas, cfg)
	WirePluginContentWrites(plugins, atlas, cfg)
	WireListUndoJournal(atlas, cfg)
}

// WireListUndoJournal points Configure's List row doors at the app's
// ONE actor-scoped undo journal (ADR-0044, goal 0352): a cell edit
// made in a board table or on the List page lands on the same history,
// in order, as the board mutation before it -- so ⌘Z undoes the cell
// edit rather than reaching past it to the table's own create.
func WireListUndoJournal(atlas *atlassvc.AtlasService, cfg *configuresvc.ConfigureService) {
	cfg.WireUndoJournal(atlas.RecordExternalUndo)
}

// WirePluginContentWrites connects pluginsvc's guarded content-write
// seam (docs/goals/0289) to the atlas plugin-actor doors and
// Configure's List row append -- one guard, the same writes an agent
// reaches, never a parallel path.
func WirePluginContentWrites(plugins *pluginsvc.PluginService, atlas *atlassvc.AtlasService, cfg *configuresvc.ConfigureService) {
	plugins.WireContentWrites(pluginContentWriter{atlas: atlas, cfg: cfg})
}

type pluginContentWriter struct {
	atlas *atlassvc.AtlasService
	cfg   *configuresvc.ConfigureService
}

func (w pluginContentWriter) CreateNote(text, parentID string, pos *atlasdomain.Position) (atlasdomain.Note, error) {
	return w.atlas.CreateNoteForPlugin(text, parentID, pos)
}

func (w pluginContentWriter) CreateCard(kindID, title, note string, fields map[string]string, parentID string) (atlasdomain.Card, error) {
	return w.atlas.CreateCardForPlugin(kindID, title, note, fields, parentID)
}

func (w pluginContentWriter) UpdateCard(id, title, note string, fields map[string]string) (atlasdomain.Card, error) {
	return w.atlas.UpdateCardForPlugin(id, title, note, fields)
}

func (w pluginContentWriter) AppendListRow(listID string, values map[string]string) error {
	_, err := w.cfg.AddListRow(listID, values)
	return err
}

func (w pluginContentWriter) CreateList(label, description string, columns []typedfield.Field, rows []map[string]string) (string, error) {
	l, err := w.cfg.CreateListWithRows(label, description, columns, rows)
	return l.ID, err
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

// WireAuditTrails constructs the MCP call audit trail (goal 0159 slice
// 1) against dbPath, wires mcpclient's package-level sending
// middleware, and opens secretService's own secret-read audit store
// (goal 0203 S3) against the SAME dbPath -- one call rather than two
// separate main.go call sites, same 500-line reason this package
// exists. Both trails share dbPath by construction (the execution
// SQLite file, each through its own independent connection) but not a
// table: secretauditstore's own doc comment has the "never mcpaudit's
// table" reasoning. Called only once dbPath is resolved, which is AFTER
// WireSecrets already constructed secretService earlier in main.go's
// own sequence -- secretService's audit store can't open until then.
// Exits the process on failure for either store: dbPath's file is
// already proven writable by DBOS's own successful open before main.go
// ever calls this, so a failure here means a real environment problem,
// matching executionsvc.NewExecutionService's own
// fatal-on-construction-failure posture. Both stores close together
// too, inside RunShutdown below.
func WireAuditTrails(secretService *secretsvc.SecretService, dbPath string, logger *slog.Logger) *mcpauditsvc.MCPAuditService {
	svc, err := mcpauditsvc.New(dbPath, logger)
	if err != nil {
		log.Fatal(err)
	}
	mcpclient.SetSendingMiddleware(svc.ClientMiddleware())
	if err := secretService.OpenAudit(dbPath, logger); err != nil {
		log.Fatal(err)
	}
	return svc
}

// WireRemoteAuth constructs docs/goals/0132-remote-access.md SLICE 1's
// auth gate. Its result feeds two places in main.go: the Services
// list (so Settings > Remote access can call it) and
// application.Options.Assets.Middleware (so it gates every request the
// AssetServer serves) -- pulled out here for the same 500-line reason
// WireAuditTrails above is. BootstrapPairingCode runs immediately after
// construction, gated on the build-tag-derived server flag: SLICE 1b's
// fix for the bootstrap deadlock a non-loopback-bound server instance
// hits otherwise (see that method's own doc comment).
func WireRemoteAuth(store settings.Store, logger *slog.Logger) *remoteauthsvc.RemoteAuthService {
	svc := remoteauthsvc.New(store, logger)
	svc.BootstrapPairingCode(buildinfo.Read().Server)
	return svc
}

// WireBrowserBridge constructs the browser bridge and starts its own
// loopback listener. It gets a listener of its own rather than a route
// on the AssetServer because a desktop build has no listening socket at
// all -- Wails serves that build's assets in-process to its own webview
// -- so a browser extension has nothing to reach there. One listener
// works identically in both builds.
//
// A bind failure is logged, not fatal. The bridge is additive; the
// rest of Mill runs unchanged with no browser paired.
func WireBrowserBridge(remoteAuth *remoteauthsvc.RemoteAuthService, logger *slog.Logger, extension fs.FS, extensionParentDir string) *bridgesvc.BridgeService {
	svc := bridgesvc.New(remoteAuth, logger)
	// The extension's files are embedded at the composition root (the
	// only place that can embed a path outside internal/), and written
	// to a real folder when someone asks to load it into a browser.
	if sub, err := fs.Sub(extension, "examples/browser-extension"); err == nil {
		svc.SetExtensionBundle(sub, extensionParentDir)
	} else {
		logger.Error("browser extension bundle", "error", err)
	}
	// The browser-replay step's seam onto the paired browser: composition
	// owns what a step MEANS, this service owns the channel, and this is
	// the only place the two meet.
	composition.SetBrowserReplayer(func(flow browserbridge.UserFlow, timeout time.Duration) (composition.BrowserReplayOutcome, error) {
		outcome, err := svc.Replay(context.Background(), flow, bridgesvc.ReplayOptions{Timeout: timeout})
		return browserReplayOutcome(outcome), err
	})
	errCh := svc.Start()
	status := svc.BridgeStatus()
	select {
	case err := <-errCh:
		logger.Error("browser bridge listener", "error", err)
	case <-time.After(bridgeBindGrace):
		logger.Info("browser bridge listening", "addr", status.Address)
	}
	return svc
}

// browserReplayOutcome restates a finished replay in composition's own
// vocabulary. A FAILED run's outcome is carried across too -- the step
// names the failing step from it, so an error is never the only thing
// that survives the boundary.
func browserReplayOutcome(outcome bridgesvc.Outcome) composition.BrowserReplayOutcome {
	steps := make([]composition.BrowserReplayStep, 0, len(outcome.Results))
	for _, r := range outcome.Results {
		steps = append(steps, composition.BrowserReplayStep{
			Index: r.Index, Status: r.Status, Error: r.Error, Extracted: r.Extracted,
		})
	}
	return composition.BrowserReplayOutcome{Steps: steps, Downloads: outcome.Downloads}
}

// bridgeBindGrace is how long WireBrowserBridge waits for a bind
// failure to surface before declaring the listener up. ListenAndServe
// reports a taken port within microseconds; this only has to outlast
// that, never a real startup.
const bridgeBindGrace = 200 * time.Millisecond

// WireClipboardHistory connects goal 0234's clipboard-history service to
// its two cross-service seams: composition's apply-clipboard-history-
// store node persists through clipboardHistoryService.Append, and a
// copy-back leaves one audit line through secretService's own audit
// store (ContextClipboardHistoryCopy) -- the SAME store every vault-
// secret read already writes to, never a second one.
func WireClipboardHistory(clipboardHistoryService *clipboardhistorysvc.ClipboardHistoryService, secretService *secretsvc.SecretService) {
	composition.SetClipboardHistoryAppender(clipboardHistoryService.Append)
	clipboardhistorysvc.SetAuditRecorder(func(entryID, label string) {
		secretService.RecordAccess(entryID, label, secretaudit.AccessContext{Context: secretaudit.ContextClipboardHistoryCopy}, secretaudit.OutcomeRead, "")
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

// WireMillMCPService late-binds every cross-service seam MillMCPService
// needs (docs/adr/0047 §5.4's guardrail wiring included) and starts its
// HTTP listener -- a bind failure is logged, not fatal, since this is
// additive local tooling the rest of the app doesn't depend on to
// function.
func WireMillMCPService(mill *mcpsvc.MillMCPService, settingsService *settingssvc.SettingsService, exec *executionsvc.ExecutionService, atlas *atlassvc.AtlasService, audit *mcpauditsvc.MCPAuditService, guard *guardrailsvc.GuardrailService, addr string, logger *slog.Logger) {
	settingsService.SetMCPService(mill)
	mill.SetExecutionService(exec)
	mill.SetAtlasService(atlas)
	mill.SetAuditResolver(audit.ResolveParkedWrite)
	mill.SetGuardrailService(guard)
	if err := mill.Start(addr); err != nil {
		logger.Error("mill MCP server", "error", err)
	} else {
		logger.Info("mill MCP server listening", "addr", addr)
	}
}

// WireWorkflowLifecycle connects CompositionService's workflow
// lifecycle to TriggerService (docs/goals/0250): the sync seam, the
// delete-releases-hotkey hook, and a one-shot orphan prune healing
// bindings already leaked by deletes that predate the hook -- safe to
// run here because both services have loaded their persisted state by
// wire time.
func WireWorkflowLifecycle(comp *compositionsvc.CompositionService, triggers *triggersvc.TriggerService) {
	comp.SetSyncer(triggers)
	comp.SetWorkflowDeleted(triggers.UnassignHotkey)
	workflows := comp.Workflows()
	ids := make([]string, 0, len(workflows))
	for _, wf := range workflows {
		ids = append(ids, wf.ID)
	}
	triggers.PruneOrphanedHotkeys(ids)
}

// WireCodingLoopEnvPreview connects the Confirm screen's environment
// line (docs/goals/0240 S4): the seeded shell step's CURRENT envId
// (read live from CompositionService, so an edit takes effect on the
// next preview) joined to that environment's label/shell/dir from
// ConfigureService's plain entity list -- deliberately NOT the
// secret-resolving lookup, since a preview must never trigger vault
// reads or their audit lines.
func WireCodingLoopEnvPreview(codeLoop *codeloopsvc.CodeLoopService, comp *compositionsvc.CompositionService, cfg *configuresvc.ConfigureService) {
	codeLoop.SetShellEnvPreview(func() (string, string, string, bool) {
		envID := codingLoopShellEnvID(comp)
		if envID == "" {
			return "", "", "", false
		}
		for _, e := range cfg.ExecEnvs() {
			if e.ID == envID {
				return e.Label, string(e.Shell), e.Dir, true
			}
		}
		return "", "", "", false
	})
}

// codingLoopShellEnvID reads the seeded shell step's current envId.
func codingLoopShellEnvID(comp *compositionsvc.CompositionService) string {
	for _, wf := range comp.Workflows() {
		if wf.ID != composition.CodingLoopWorkflowID {
			continue
		}
		for _, n := range wf.Nodes {
			if n.ID == composition.CodingLoopShellStepID {
				return strings.TrimSpace(n.Config["envId"])
			}
		}
	}
	return ""
}
