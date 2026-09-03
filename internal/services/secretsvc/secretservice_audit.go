package secretsvc

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/alicoding/mill/internal/adapters/secretaudit"
	"github.com/alicoding/mill/internal/adapters/secretauditstore"
)

// AuditRetentionKeep mirrors mcpauditsvc.RetentionKeep's own number and
// reasoning (goal 0203 S3's contract: "capped retention matching
// mcpaudit's numbers").
const AuditRetentionKeep = 10000

// OpenAudit opens the secret-read audit store at dbPath -- the SAME
// execution SQLite file mcpauditstore/backupsvc already share their own
// independent connections to, reached through secretauditstore's own
// connection (never mcpaudit's table: a secret read is not an MCP
// call). Exported for wiring only, never a frontend RPC: main.go/
// wiring.go call this AFTER WireSecrets constructs the service, once
// the execution database path is resolved (WireSecrets itself runs
// before that resolution in main.go's own sequence). A SecretService
// with no audit store opened (every test that constructs one directly
// without calling this) simply doesn't record -- recordAccess's own nil
// guard -- since a secret still needs to resolve correctly whether or
// not anything is listening for its audit line.
//
//wails:ignore
func (s *SecretService) OpenAudit(dbPath string, logger *slog.Logger) error {
	store, err := secretauditstore.Open(dbPath)
	if err != nil {
		return fmt.Errorf("secretsvc: open audit store: %w", err)
	}
	if logger == nil {
		logger = slog.Default()
	}
	s.auditStore = store
	s.auditLog = logger
	if _, err := store.Prune(AuditRetentionKeep); err != nil {
		// Retention pruning is housekeeping, not correctness -- same
		// log-and-continue posture mcpauditsvc.New's own prune-at-boot
		// failure takes.
		logger.Error("secret audit: prune at boot", "error", err)
	}
	return nil
}

// CloseAudit closes the audit store's own connection -- exported for
// main.go's shutdown sequence only (mirrors mcpAuditService.Close's own
// call site), never a frontend RPC. A no-op when OpenAudit was never
// called (every test).
//
//wails:ignore
func (s *SecretService) CloseAudit() error {
	if s.auditStore == nil {
		return nil
	}
	return s.auditStore.Close()
}

// recordAccess writes one secret-read audit line -- best-effort: a
// failed write is logged, never returned to the caller, since a secret
// read that already succeeded (or already failed on its own terms) must
// not additionally fail because its OWN audit trail couldn't be
// written. Silently does nothing when no audit store is wired (every
// test that constructs SecretService without calling OpenAudit) --
// audit is observability, not a correctness gate on resolution.
func (s *SecretService) recordAccess(entryID, label string, actx secretaudit.AccessContext, outcome secretaudit.Outcome, errText string) {
	if s.auditStore == nil {
		return
	}
	rec := secretaudit.Record{
		EntryID: entryID, Label: label, Context: actx.Context,
		RunID: actx.RunID, WorkflowID: actx.WorkflowID, Actor: actx.Actor,
		Outcome: outcome, ErrorText: errText,
	}
	if _, err := s.auditStore.Insert(context.Background(), rec); err != nil {
		s.auditLog.Error("secret audit: insert", "error", err, "entryId", entryID, "context", actx.Context)
	}
}

// RecordAccess is recordAccess exported for a caller outside this
// package (goal 0234: clipboardhistorysvc's own copy-back action, wired
// through an injected function var so that package doesn't import
// secretsvc directly -- .claude/rules/backend.md's cross-service seam
// rule). The SAME audit store every vault-secret read already writes
// to, reused rather than a second one; EntryID/Context tell a Clipboard
// history row apart from a vault-secret row in the shared list.
// Exported for wiring only, never a frontend RPC.
//
//wails:ignore
func (s *SecretService) RecordAccess(entryID, label string, actx secretaudit.AccessContext, outcome secretaudit.Outcome, errText string) {
	s.recordAccess(entryID, label, actx, outcome, errText)
}

// ListSecretAccessRequest is the bound read API's request shape --
// EntryID empty means "no filter" (the Secrets view's global Access
// history list); set means "this one entry's own history" (the detail
// dialog's own filtered view). Mirrors mcpauditsvc.ListMCPCallsRequest's
// own shape.
type ListSecretAccessRequest struct {
	EntryID string `json:"entryId"`
	// ActorPrefix narrows to actors starting with it (the plugin audit
	// export passes "plugin:"); empty means every actor.
	ActorPrefix string `json:"actorPrefix"`
	Limit       int    `json:"limit"`
	Offset      int    `json:"offset"`
}

// SecretAccessRecord is the frontend-facing JSON shape for one audit
// row -- mirrors secretaudit.Record with JSON tags added, same
// "adapter type stays free of a frontend-JSON concern" reasoning
// mcpauditsvc.MCPCallRecord's own doc comment gives.
type SecretAccessRecord struct {
	ID         int64  `json:"id"`
	Timestamp  string `json:"timestamp"`
	EntryID    string `json:"entryId"`
	Label      string `json:"label"`
	Context    string `json:"context"`
	RunID      string `json:"runId"`
	WorkflowID string `json:"workflowId"`
	Actor      string `json:"actor"`
	Outcome    string `json:"outcome"`
	ErrorText  string `json:"errorText"`
}

// ListSecretAccessResponse carries one page plus the total matching-row
// count, same "showing X-Y of Z" reasoning ListMCPCallsResponse gives.
type ListSecretAccessResponse struct {
	Records []SecretAccessRecord `json:"records"`
	Total   int                  `json:"total"`
}

// secretAccessDefaultLimit/MaxLimit mirror mcpauditsvc's own
// default/cap numbers for the identical reasoning: a caller that omits
// Limit gets a sane default, one that asks for too much gets capped,
// never an unbounded query.
const (
	secretAccessDefaultLimit = 50
	secretAccessMaxLimit     = 500
)

// ListSecretAccess is the bound read API the Secrets view's Access
// history list calls -- newest first, optionally filtered to one entry,
// limit/offset paged. Returns an empty page (never an error) when no
// audit store is wired yet -- structurally unreachable in the real app
// (main.go wires OpenAudit before any window/frontend exists), kept
// graceful rather than surfacing a confusing error on a race that can't
// actually happen.
func (s *SecretService) ListSecretAccess(req ListSecretAccessRequest) (ListSecretAccessResponse, error) {
	if s.auditStore == nil {
		return ListSecretAccessResponse{}, nil
	}
	limit := req.Limit
	if limit <= 0 {
		limit = secretAccessDefaultLimit
	}
	if limit > secretAccessMaxLimit {
		limit = secretAccessMaxLimit
	}
	offset := req.Offset
	if offset < 0 {
		offset = 0
	}

	records, total, err := s.auditStore.List(secretauditstore.Filter{EntryID: req.EntryID, ActorPrefix: req.ActorPrefix}, limit, offset)
	if err != nil {
		return ListSecretAccessResponse{}, fmt.Errorf("secretsvc: list secret access: %w", err)
	}
	out := make([]SecretAccessRecord, 0, len(records))
	for _, r := range records {
		out = append(out, SecretAccessRecord{
			ID: r.ID, Timestamp: r.Timestamp.Format("2006-01-02T15:04:05.000Z07:00"),
			EntryID: r.EntryID, Label: r.Label, Context: string(r.Context),
			RunID: r.RunID, WorkflowID: r.WorkflowID, Actor: r.Actor, Outcome: string(r.Outcome), ErrorText: r.ErrorText,
		})
	}
	return ListSecretAccessResponse{Records: out, Total: total}, nil
}
