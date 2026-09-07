package secretauditstore

import (
	"context"
	"fmt"

	"github.com/alicoding/mill/internal/adapters/auditstore"
	"github.com/alicoding/mill/internal/adapters/secretaudit"
	"github.com/alicoding/mill/internal/domain/audit"
)

// Filter narrows List's result set -- EntryID empty means "no filter,"
// mirroring mcpauditstore.Filter's own convention. The Secrets view's
// per-entry detail dialog sets EntryID; the global Access history list
// leaves it empty.
type Filter struct {
	EntryID string
	// ActorPrefix keeps only rows whose actor starts with it -- the
	// plugin audit export's "plugin:" slice (ADR-0051 §4). Empty means
	// no filter.
	ActorPrefix string
}

// List returns, newest first, the page of records matching filter
// starting at offset and holding at most limit rows, plus the total row
// count matching filter (ignoring limit/offset) -- mirrors
// mcpauditstore.List's own paging contract. EntryID and ActorPrefix
// both map onto real columns (target_id, source) on the shared table,
// so filtering and paging both happen in SQL, unlike mcpauditstore's
// own Direction filter.
func (s *Store) List(filter Filter, limit, offset int) ([]secretaudit.Record, int, error) {
	where := "WHERE kind = ?"
	args := []any{string(audit.KindSecretAccess)}
	if filter.EntryID != "" {
		where += " AND target_id = ?"
		args = append(args, filter.EntryID)
	}
	if filter.ActorPrefix != "" {
		where += " AND substr(source, 1, ?) = ?"
		args = append(args, len(filter.ActorPrefix), filter.ActorPrefix)
	}

	//nolint:gosec // G202: auditstore.TableName/where are built from this package's own compile-time constants and column names, never caller input; every caller-supplied value is bound as a placeholder in args.
	countQ := "SELECT COUNT(*) FROM " + auditstore.TableName + " " + where
	var total int
	if err := s.db.QueryRowContext(context.Background(), countQ, args...).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("secretauditstore: count: %w", err)
	}

	//nolint:gosec // G202: EntryColumns/TableName/where are all built from this package's own compile-time constants and column names, never caller input; every caller-supplied value is bound as a placeholder in args.
	q := "SELECT " + auditstore.EntryColumns + " FROM " + auditstore.TableName + " " + where + " ORDER BY id DESC LIMIT ? OFFSET ?"
	rows, err := s.db.QueryContext(context.Background(), q, append(args, limit, offset)...)
	if err != nil {
		return nil, 0, fmt.Errorf("secretauditstore: list: %w", err)
	}
	defer func() { _ = rows.Close() }()

	var out []secretaudit.Record
	for rows.Next() {
		e, err := auditstore.ScanEntry(rows)
		if err != nil {
			return nil, 0, fmt.Errorf("secretauditstore: list: %w", err)
		}
		out = append(out, fromEntry(e))
	}
	if err := rows.Err(); err != nil {
		return nil, 0, fmt.Errorf("secretauditstore: list: %w", err)
	}
	return out, total, nil
}
