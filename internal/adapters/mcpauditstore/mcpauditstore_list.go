package mcpauditstore

import (
	"context"
	"fmt"
	"time"

	"github.com/alicoding/mill/internal/adapters/mcpaudit"
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
// row count matching filter (ignoring limit/offset) -- the bound read
// API's own limit/offset paging, and the total a "showing X-Y of Z"
// caption needs.
func (s *Store) List(filter Filter, limit, offset int) ([]mcpaudit.Record, int, error) {
	where := "WHERE 1=1"
	args := []any{}
	if filter.Direction != "" {
		where += " AND direction = ?"
		args = append(args, string(filter.Direction))
	}
	if filter.Tool != "" {
		where += " AND tool_name = ?"
		args = append(args, filter.Tool)
	}

	var total int
	if err := s.db.QueryRowContext(context.Background(), "SELECT COUNT(*) FROM mcp_calls "+where, args...).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("mcpauditstore: count: %w", err)
	}

	q := "SELECT id, timestamp, direction, session_id, method_name, tool_name, caller_identity, outcome, duration_ms, error_text, arg_bytes, parked_write_id FROM mcp_calls " +
		where + " ORDER BY id DESC LIMIT ? OFFSET ?"
	rows, err := s.db.QueryContext(context.Background(), q, append(args, limit, offset)...)
	if err != nil {
		return nil, 0, fmt.Errorf("mcpauditstore: list: %w", err)
	}
	defer func() { _ = rows.Close() }()

	var out []mcpaudit.Record
	for rows.Next() {
		var r mcpaudit.Record
		var ts, direction, outcome string
		if err := rows.Scan(&r.ID, &ts, &direction, &r.SessionID, &r.MethodName, &r.ToolName, &r.CallerIdentity,
			&outcome, &r.DurationMS, &r.ErrorText, &r.ArgBytes, &r.ParkedWriteID); err != nil {
			return nil, 0, fmt.Errorf("mcpauditstore: scan: %w", err)
		}
		r.Direction = mcpaudit.Direction(direction)
		r.Outcome = mcpaudit.Outcome(outcome)
		if parsed, err := time.Parse(timestampLayout, ts); err == nil {
			r.Timestamp = parsed
		}
		out = append(out, r)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, fmt.Errorf("mcpauditstore: list: %w", err)
	}
	return out, total, nil
}
