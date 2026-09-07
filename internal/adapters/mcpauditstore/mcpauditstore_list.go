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
// the shared row's own target_id column (a real, indexable column);
// Direction lives only inside Attributes (goal 0351's envelope has no
// dedicated column for it), so it's applied in Go after fetching every
// kind="mcp-call" row matching Tool -- bounded by this kind's own
// retention cap, never unbounded.
func (s *Store) List(filter Filter, limit, offset int) ([]mcpaudit.Record, int, error) {
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
		if filter.Direction != "" && r.Direction != filter.Direction {
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
