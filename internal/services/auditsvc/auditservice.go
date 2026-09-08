// Package auditsvc is the Wails-bound owner of goal 0351's one shared
// export door and one shared retention cap over
// internal/adapters/auditstore's audit_entries table -- the table
// mcpauditstore, secretauditstore and bridgesvc each already write
// into through their OWN independent connections (the per-service
// pattern this package follows too, same reasoning mcpauditstore.Open's
// own doc comment gives). This package never receives a producer's
// individual rows; it only reads (export) and prunes (retention) across
// every kind at once, since both are properties of the SHARED trail,
// not of any one producer.
package auditsvc

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/alicoding/mill/internal/adapters/auditstore"
)

// AuditService owns the shared store's export and retention surface.
type AuditService struct {
	store *auditstore.Store
	log   *slog.Logger
}

// New opens dbPath (the same execution SQLite file mcpauditstore/
// secretauditstore/bridgesvc's own audit connections already share)
// and prunes it down to retentionKeep before returning -- "prune at
// boot" mirrors mcpauditsvc.New's own posture, now applied ONCE across
// every kind instead of once per producer's own table (goal 0351
// Decision 4: one shared cap, per-source caps removed).
func New(dbPath string, retentionKeep int, logger *slog.Logger) (*AuditService, error) {
	store, err := auditstore.Open(dbPath)
	if err != nil {
		return nil, fmt.Errorf("auditsvc: %w", err)
	}
	if logger == nil {
		logger = slog.Default()
	}
	s := &AuditService{store: store, log: logger}
	s.PruneNow(retentionKeep)
	return s, nil
}

//wails:ignore
func (s *AuditService) Close() error {
	return s.store.Close()
}

// PruneNow prunes the shared table to keep newest rows across every
// kind, right now -- called at boot (New) and again whenever
// settingssvc.SetAuditRetentionEntries persists a new cap
// (SettingsService.SetAuditRetentionChanged's own wiring, main.go),
// so a lowered cap takes effect immediately rather than only at the
// next restart. Best-effort: retention pruning is housekeeping, not
// correctness, so a failure is logged and never returned.
//
//wails:ignore
func (s *AuditService) PruneNow(keep int) {
	if _, err := s.store.Prune(context.Background(), keep); err != nil {
		s.log.Error("audit: prune", "error", err)
	}
}
