package pluginsvc

import (
	"context"
	"log/slog"

	"github.com/alicoding/mill/internal/adapters/auditstore"
	"github.com/alicoding/mill/internal/domain/audit"
)

// guardedActionErrorTextCap mirrors mcpaudit.ErrorTextCap/
// bridgeErrorTextCap's own value and reasoning: an oversized error must
// never let one audit row dominate the shared retention window.
const guardedActionErrorTextCap = 4096

// OpenAudit opens the shared audit trail's own connection at dbPath --
// the SAME execution SQLite file mcpauditstore/secretauditstore/
// bridgesvc's own OpenAudit each connect to independently (goal 0374,
// closing the write half pluginservice_audit.go's export already
// reads through a different door -- the guardrail's own 24h pending
// store, which deletes an allow/deny record on resolution and never
// retains an inline-confirmed write at all). A failure here is logged
// and non-fatal, the same posture BridgeService.OpenAudit already
// states: a plugin still runs with no audit store wired, the same way
// it runs with no guardrail wired.
//
//wails:ignore
func (p *PluginService) OpenAudit(dbPath string, logger *slog.Logger) {
	if dbPath == "" {
		// No file named: a test harness that never needs a live audit
		// store (servicetest's own convention), not a real install.
		return
	}
	store, err := auditstore.Open(dbPath)
	if err != nil {
		if logger == nil {
			logger = slog.Default()
		}
		logger.Error("plugin service: open audit store", "error", err)
		return
	}
	if logger == nil {
		logger = slog.Default()
	}
	p.auditStore = store
	p.auditLog = logger
}

// CloseAudit closes the audit store's own connection -- a no-op when
// OpenAudit never ran or failed (every test that doesn't call it).
//
//wails:ignore
func (p *PluginService) CloseAudit() error {
	if p.auditStore == nil {
		return nil
	}
	return p.auditStore.Close()
}

// recordGuardedAction writes one guarded-action audit row, best-effort
// (a failed write is logged, never returned -- the plugin's own write
// is never held up or failed by its own audit trail, matching
// bridgesvc.recordCommand's identical posture). Silently does nothing
// when no audit store is wired (a test harness with no OpenAudit
// call). outcome is the producer's own vocabulary (goal 0351's Entry
// doc comment): "allow", "deny", or "ask -- confirmed inline by the
// user" -- never silently promoted to "allow", so the trail keeps
// which gate a write actually crossed.
func (p *PluginService) recordGuardedAction(ctx context.Context, pluginID string, plugin PluginInfo, kind, itemKey, integrationID, outcome, ruleLabel, errText string) {
	if p.auditStore == nil {
		return
	}
	attrs := map[string]string{
		"plugin_id":      pluginID,
		"plugin_builtin": boolAttr(plugin.Builtin),
	}
	if itemKey != "" {
		attrs["item_key"] = itemKey
	}
	if integrationID != "" {
		attrs["integration_id"] = integrationID
	}
	if ruleLabel != "" {
		attrs["rule_label"] = ruleLabel
	}
	if errText != "" {
		if len(errText) > guardedActionErrorTextCap {
			errText = errText[:guardedActionErrorTextCap]
		}
		attrs["error_text"] = errText
	}
	entry := audit.Entry{
		Kind:       audit.KindGuardedAction,
		Action:     kind,
		Target:     audit.Target{Kind: "external-item", ID: itemKey, Label: itemKey},
		Actor:      audit.Actor{Source: "plugin:" + pluginID},
		Outcome:    outcome,
		Attributes: attrs,
	}
	if _, err := p.auditStore.Append(ctx, entry); err != nil {
		p.auditLog.Error("plugin audit: append", "error", err, "kind", kind)
	}
}

func boolAttr(b bool) string {
	if b {
		return "true"
	}
	return "false"
}
