package auditstore

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/alicoding/mill/internal/domain/audit"
)

// Filter narrows List's result set -- every field is optional (a zero
// value means "no filter"). Kinds empty means every kind; the goal
// 0351 PR2 reader (the shared export, a future Activity "Audit"
// section) is the caller that actually sets more than one.
type Filter struct {
	Kinds    []audit.Kind
	RunID    string
	TargetID string
	Since    time.Time
	Until    time.Time
	Limit    int
	// Cursor is the last-seen row id from a previous Page's NextCursor
	// -- List returns rows with id < Cursor. Zero means "start from the
	// newest row".
	Cursor int64
}

// defaultLimit mirrors mcpauditstore/secretauditstore's own
// "a caller that omits Limit gets a sane default" reasoning.
const defaultLimit = 50

// Page is one page of newest-first entries plus the cursor to pass back
// for the next page.
type Page struct {
	Entries    []audit.Entry
	NextCursor int64
	HasMore    bool
}

// List returns, newest first, entries matching filter -- one page at a
// time, cursor-paged rather than offset-paged (an offset drifts under
// concurrent inserts; a cursor doesn't).
func (s *Store) List(ctx context.Context, filter Filter) (Page, error) {
	where, args := buildWhere(filter)
	limit := filter.Limit
	if limit <= 0 {
		limit = defaultLimit
	}
	//nolint:gosec // G202: EntryColumns/TableName/where are all built from this package's own compile-time constants and column names, never caller input; every caller-supplied value is bound as a placeholder in args.
	q := "SELECT " + EntryColumns + " FROM " + TableName + " " + where + " ORDER BY id DESC LIMIT ?"
	rows, err := s.db.QueryContext(ctx, q, append(args, limit+1)...)
	if err != nil {
		return Page{}, fmt.Errorf("auditstore: list: %w", err)
	}
	defer func() { _ = rows.Close() }()

	var entries []audit.Entry
	for rows.Next() {
		e, err := ScanEntry(rows)
		if err != nil {
			return Page{}, err
		}
		entries = append(entries, e)
	}
	if err := rows.Err(); err != nil {
		return Page{}, fmt.Errorf("auditstore: list: %w", err)
	}

	page := Page{Entries: entries}
	if len(entries) > limit {
		page.Entries = entries[:limit]
		page.HasMore = true
	}
	if len(page.Entries) > 0 {
		page.NextCursor = page.Entries[len(page.Entries)-1].ID
	}
	return page, nil
}

func buildWhere(filter Filter) (string, []any) {
	var clauses []string
	var args []any
	if len(filter.Kinds) > 0 {
		placeholders := make([]string, len(filter.Kinds))
		for i, k := range filter.Kinds {
			placeholders[i] = "?"
			args = append(args, string(k))
		}
		clauses = append(clauses, "kind IN ("+strings.Join(placeholders, ", ")+")")
	}
	if filter.RunID != "" {
		clauses = append(clauses, "run_id = ?")
		args = append(args, filter.RunID)
	}
	if filter.TargetID != "" {
		clauses = append(clauses, "target_id = ?")
		args = append(args, filter.TargetID)
	}
	if !filter.Since.IsZero() {
		clauses = append(clauses, "timestamp >= ?")
		args = append(args, filter.Since.Format(timestampLayout))
	}
	if !filter.Until.IsZero() {
		clauses = append(clauses, "timestamp <= ?")
		args = append(args, filter.Until.Format(timestampLayout))
	}
	if filter.Cursor > 0 {
		clauses = append(clauses, "id < ?")
		args = append(args, filter.Cursor)
	}
	if len(clauses) == 0 {
		return "WHERE 1=1", args
	}
	return "WHERE " + strings.Join(clauses, " AND "), args
}
