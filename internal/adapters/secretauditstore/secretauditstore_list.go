package secretauditstore

import (
	"context"
	"fmt"
	"time"

	"github.com/alicoding/mill/internal/adapters/secretaudit"
)

// Filter narrows List's result set -- EntryID empty means "no filter,"
// mirroring mcpauditstore.Filter's own convention. The Secrets view's
// per-entry detail dialog sets EntryID; the global Access history list
// leaves it empty.
type Filter struct {
	EntryID string
}

// List returns, newest first, the page of records matching filter
// starting at offset and holding at most limit rows, plus the total row
// count matching filter (ignoring limit/offset) -- mirrors
// mcpauditstore.List's own paging contract.
func (s *Store) List(filter Filter, limit, offset int) ([]secretaudit.Record, int, error) {
	where := "WHERE 1=1"
	args := []any{}
	if filter.EntryID != "" {
		where += " AND entry_id = ?"
		args = append(args, filter.EntryID)
	}

	var total int
	if err := s.db.QueryRowContext(context.Background(), "SELECT COUNT(*) FROM secret_access "+where, args...).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("secretauditstore: count: %w", err)
	}

	q := "SELECT id, timestamp, entry_id, label, context, run_id, workflow_id, outcome, error_text FROM secret_access " +
		where + " ORDER BY id DESC LIMIT ? OFFSET ?"
	rows, err := s.db.QueryContext(context.Background(), q, append(args, limit, offset)...)
	if err != nil {
		return nil, 0, fmt.Errorf("secretauditstore: list: %w", err)
	}
	defer func() { _ = rows.Close() }()

	var out []secretaudit.Record
	for rows.Next() {
		var r secretaudit.Record
		var ts, ctxVal, outcome string
		if err := rows.Scan(&r.ID, &ts, &r.EntryID, &r.Label, &ctxVal, &r.RunID, &r.WorkflowID, &outcome, &r.ErrorText); err != nil {
			return nil, 0, fmt.Errorf("secretauditstore: scan: %w", err)
		}
		r.Context = secretaudit.Context(ctxVal)
		r.Outcome = secretaudit.Outcome(outcome)
		if parsed, err := time.Parse(timestampLayout, ts); err == nil {
			r.Timestamp = parsed
		}
		out = append(out, r)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, fmt.Errorf("secretauditstore: list: %w", err)
	}
	return out, total, nil
}
