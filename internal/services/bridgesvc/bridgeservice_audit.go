package bridgesvc

import (
	"context"
	"log/slog"
	"strconv"

	"github.com/alicoding/mill/internal/adapters/auditstore"
	"github.com/alicoding/mill/internal/domain/audit"
)

// bridgeErrorTextCap mirrors mcpaudit.ErrorTextCap/secretaudit.ErrorTextCap's
// own value and reasoning: an oversized error must never let one audit
// row dominate the shared retention window.
const bridgeErrorTextCap = 4096

// OpenAudit opens the shared audit trail's own connection at dbPath --
// the SAME execution SQLite file mcpauditstore/secretauditstore already
// connect to independently. Unlike mcpauditsvc.New/secretsvc.OpenAudit,
// a failure here is logged and NON-fatal: WireBrowserBridge's own doc
// comment already states the bridge is additive and a bind failure
// doesn't stop the rest of Mill, and the same posture extends to its
// audit trail -- a browser extension still works with no audit store
// wired, the same way it works with no browser paired.
//
//wails:ignore
func (s *BridgeService) OpenAudit(dbPath string, logger *slog.Logger) {
	store, err := auditstore.Open(dbPath)
	if err != nil {
		s.logger.Error("browser bridge: open audit store", "error", err)
		return
	}
	if logger == nil {
		logger = slog.Default()
	}
	s.auditStore = store
	s.auditLog = logger
}

// CloseAudit closes the audit store's own connection -- a no-op when
// OpenAudit never ran or failed (every test that doesn't call it).
//
//wails:ignore
func (s *BridgeService) CloseAudit() error {
	if s.auditStore == nil {
		return nil
	}
	return s.auditStore.Close()
}

// recordCommand writes one bridge-command audit row, best-effort: a
// failed write is logged, never returned to the caller, so a browser's
// own request is never held up or failed by its own audit trail
// (mirrors secretsvc.recordAccess's identical posture). Silently does
// nothing when no audit store is wired. ctx is the caller's own
// request/call context (an HTTP handler's r.Context(), or Replay's own
// ctx) -- never context.Background() invented here, so a cancelled
// request's audit write is cancelled the same way its response is.
func (s *BridgeService) recordCommand(ctx context.Context, action string, target audit.Target, actorSource, outcome, failureKind string, statusCode int, errText string) {
	if s.auditStore == nil {
		return
	}
	attrs := map[string]string{"status_code": strconv.Itoa(statusCode)}
	if errText != "" {
		if len(errText) > bridgeErrorTextCap {
			errText = errText[:bridgeErrorTextCap]
		}
		attrs["error_text"] = errText
	}
	entry := audit.Entry{
		Kind: audit.KindBridgeCommand, Action: action, Target: target,
		Actor: audit.Actor{Source: actorSource}, Outcome: outcome, FailureKind: failureKind,
		Attributes: attrs,
	}
	if _, err := s.auditStore.Append(ctx, entry); err != nil {
		s.auditLog.Error("browser bridge audit: append", "error", err, "action", action)
	}
}
