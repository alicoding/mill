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
	if _, err := store.Prune(context.Background(), retentionKeep); err != nil {
		// Retention pruning is housekeeping, not correctness -- same
		// log-and-continue posture mcpauditsvc.New's own prune-at-boot
		// failure takes.
		logger.Error("audit: prune at boot", "error", err)
	}
	return s, nil
}

//wails:ignore
func (s *AuditService) Close() error {
	return s.store.Close()
}
