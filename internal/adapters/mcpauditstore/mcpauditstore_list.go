package mcpauditstore

import (
	"context"
	"fmt"

	"github.com/alicoding/mill/internal/adapters/auditstore"
	"github.com/alicoding/mill/internal/adapters/mcpaudit"
	"github.com/alicoding/mill/internal/domain/audit"
)

// Filter narrows List's result set -- both fields are optional
// (mcpaudit.Direction("") / "" mean "no filter"), matching the design
// contract's "filterable by direction and tool".
type Filter struct {
	Direction mcpaudit.Direction
	Tool      string
}

// List returns, newest first, the page of records matching filter
// starting at offset and holding at most limit rows, plus the total
// row count matching filter (ignoring limit/offset). Tool maps onto
// the shared row's own target_id column (a real, indexable column), so
// a Tool-only (or unfiltered) call stays a single bounded SQL query.
// Direction lives only inside Attributes (goal 0351's envelope has no
// dedicated column for it) -- a Direction-filtered call is the one path
// that must fetch every kind="mcp-call" row matching Tool and paginate
// in Go, since SQL can't test an attribute it doesn't have a column
// for; bounded by this kind's own retention cap, never unbounded.
func (s *Store) List(filter Filter, limit, offset int) ([]mcpaudit.Record, int, error) {
	if filter.Direction == "" {
		return s.listSQL(filter.Tool, limit, offset)
	}
	return s.listFilteredByDirection(filter, limit, offset)
}

// listSQL is the common, unfiltered-by-direction path: a real
// LIMIT/OFFSET query, never a full-table fetch.
func (s *Store) listSQL(tool string, limit, offset int) ([]mcpaudit.Record, int, error) {
	where := "WHERE kind = ?"
	args := []any{string(audit.KindMCPCall)}
	if tool != "" {
		where += " AND target_id = ?"
		args = append(args, tool)
	}
	ctx := context.Background()

	var total int
	//nolint:gosec // G202: TableName/where are built from this package's own compile-time constants and column names, never caller input; every caller-supplied value is bound as a placeholder in args.
	countQ := "SELECT COUNT(*) FROM " + auditstore.TableName + " " + where
	if err := s.db.QueryRowContext(ctx, countQ, args...).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("mcpauditstore: list: count: %w", err)
	}

	//nolint:gosec // G202: EntryColumns/TableName/where are all built from this package's own compile-time constants and column names, never caller input; every caller-supplied value is bound as a placeholder in args.
	q := "SELECT " + auditstore.EntryColumns + " FROM " + auditstore.TableName + " " + where + " ORDER BY id DESC LIMIT ? OFFSET ?"
	rows, err := s.db.QueryContext(ctx, q, append(args, limit, offset)...)
	if err != nil {
		return nil, 0, fmt.Errorf("mcpauditstore: list: %w", err)
	}
	defer func() { _ = rows.Close() }()

	out := []mcpaudit.Record{}
	for rows.Next() {
		e, err := auditstore.ScanEntry(rows)
		if err != nil {
			return nil, 0, fmt.Errorf("mcpauditstore: list: %w", err)
		}
		out = append(out, fromEntry(e))
	}
	if err := rows.Err(); err != nil {
		return nil, 0, fmt.Errorf("mcpauditstore: list: %w", err)
	}
	return out, total, nil
}

// listFilteredByDirection fetches every kind="mcp-call" row matching
// Tool, filters by Direction in Go, then paginates the result --
// Direction has no dedicated column to push the filter into SQL, so
// this path can't use LIMIT/OFFSET at the database level.
func (s *Store) listFilteredByDirection(filter Filter, limit, offset int) ([]mcpaudit.Record, int, error) {
	where := "WHERE kind = ?"
	args := []any{string(audit.KindMCPCall)}
	if filter.Tool != "" {
		where += " AND target_id = ?"
		args = append(args, filter.Tool)
	}

	//nolint:gosec // G202: EntryColumns/TableName/where are all built from this package's own compile-time constants and column names, never caller input; every caller-supplied value is bound as a placeholder in args.
	q := "SELECT " + auditstore.EntryColumns + " FROM " + auditstore.TableName + " " + where + " ORDER BY id DESC"
	rows, err := s.db.QueryContext(context.Background(), q, args...)
	if err != nil {
		return nil, 0, fmt.Errorf("mcpauditstore: list: %w", err)
	}
	defer func() { _ = rows.Close() }()

	var matched []mcpaudit.Record
	for rows.Next() {
		e, err := auditstore.ScanEntry(rows)
		if err != nil {
			return nil, 0, fmt.Errorf("mcpauditstore: list: %w", err)
		}
		r := fromEntry(e)
		if r.Direction != filter.Direction {
			continue
		}
		matched = append(matched, r)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, fmt.Errorf("mcpauditstore: list: %w", err)
	}

	total := len(matched)
	if offset < 0 {
		offset = 0
	}
	if offset >= total || limit <= 0 {
		return []mcpaudit.Record{}, total, nil
	}
	end := offset + limit
	if end > total {
		end = total
	}
	return matched[offset:end], total, nil
}
