// Package mcpauditsvc is the Wails-bound service owning Mill's MCP call
// audit trail's lifecycle (goal 0159 slice 1): opens the storage
// adapter, prunes retention at boot, builds the two SDK middleware
// functions (mcpauditservice_middleware.go) mcpserving/mcpclient wire
// in, and exposes the bound read API Activity's "MCP calls" section
// calls. .claude/rules/backend.md's service-owns-storage split: types
// in internal/adapters/mcpaudit, raw SQL in
// internal/adapters/mcpauditstore, lifecycle/wiring here.
package mcpauditsvc

import (
	"fmt"
	"log/slog"

	"github.com/alicoding/mill/internal/adapters/mcpaudit"
	"github.com/alicoding/mill/internal/adapters/mcpauditstore"
)

// RetentionKeep is how many newest rows survive a prune -- the design
// contract's own "keep the newest 10,000, prune at boot" number.
const RetentionKeep = 10000

// MCPAuditService wraps the storage adapter and provides the two audit
// middleware constructors plus the bound read API.
type MCPAuditService struct {
	store *mcpauditstore.Store
	log   *slog.Logger
}

// New opens dbPath (the same execution SQLite file path
// backupsvc.SQLiteDBPath already resolves for every other adapter that
// touches this file) and prunes it down to RetentionKeep before
// returning -- "prune at boot" is this constructor's own job, not a
// separate startup step main.go has to remember to call.
func New(dbPath string, logger *slog.Logger) (*MCPAuditService, error) {
	store, err := mcpauditstore.Open(dbPath)
	if err != nil {
		return nil, fmt.Errorf("mcpauditsvc: %w", err)
	}
	if logger == nil {
		logger = slog.Default()
	}
	s := &MCPAuditService{store: store, log: logger}
	if _, err := store.Prune(RetentionKeep); err != nil {
		// Retention pruning is housekeeping, not correctness -- a failed
		// prune leaves a few extra rows around, never breaks recording or
		// reading, so this is logged and Mill keeps starting rather than
		// failing boot over it.
		logger.Error("mcp audit: prune at boot", "error", err)
	}
	return s, nil
}

//wails:ignore
func (s *MCPAuditService) Close() error {
	return s.store.Close()
}

// ListMCPCallsRequest is the bound read API's request shape --
// Direction/Tool empty means "no filter" (mcpauditstore.Filter's own
// convention).
type ListMCPCallsRequest struct {
	Direction string `json:"direction"`
	Tool      string `json:"tool"`
	Limit     int    `json:"limit"`
	Offset    int    `json:"offset"`
}

// MCPCallRecord is the frontend-facing JSON shape for one audit row --
// mirrors mcpaudit.Record with JSON tags added; kept as its own type
// (rather than tagging Record itself) so the adapter-layer type stays
// free of a frontend-JSON concern.
type MCPCallRecord struct {
	ID             int64  `json:"id"`
	Timestamp      string `json:"timestamp"`
	Direction      string `json:"direction"`
	SessionID      string `json:"sessionId"`
	MethodName     string `json:"methodName"`
	ToolName       string `json:"toolName"`
	CallerIdentity string `json:"callerIdentity"`
	Outcome        string `json:"outcome"`
	DurationMS     int64  `json:"durationMs"`
	ErrorText      string `json:"errorText"`
	ArgBytes       int64  `json:"argBytes"`
}

// ListMCPCallsResponse carries one page plus the total matching-row
// count, so the frontend's "showing X-Y of Z" caption never needs a
// second round trip.
type ListMCPCallsResponse struct {
	Records []MCPCallRecord `json:"records"`
	Total   int             `json:"total"`
}

// defaultLimit/maxLimit bound the bound read API the same way every
// other paged Wails RPC in this codebase defaults/caps its own page
// size -- a caller that omits Limit (the zero value) gets a sane
// default rather than an empty page; a caller that asks for more than
// maxLimit gets capped, never an unbounded query against a 10k-row
// table.
const (
	defaultLimit = 50
	maxLimit     = 500
)

// ListMCPCalls is the bound read API Activity's "MCP calls" section
// calls -- newest first, filterable by direction/tool, limit/offset
// paged (the design contract's own words).
func (s *MCPAuditService) ListMCPCalls(req ListMCPCallsRequest) (ListMCPCallsResponse, error) {
	limit := req.Limit
	if limit <= 0 {
		limit = defaultLimit
	}
	if limit > maxLimit {
		limit = maxLimit
	}
	offset := req.Offset
	if offset < 0 {
		offset = 0
	}

	records, total, err := s.store.List(mcpauditstore.Filter{
		Direction: mcpaudit.Direction(req.Direction),
		Tool:      req.Tool,
	}, limit, offset)
	if err != nil {
		return ListMCPCallsResponse{}, fmt.Errorf("mcpauditsvc: list mcp calls: %w", err)
	}

	out := make([]MCPCallRecord, 0, len(records))
	for _, r := range records {
		out = append(out, MCPCallRecord{
			ID: r.ID, Timestamp: r.Timestamp.Format("2006-01-02T15:04:05.000Z07:00"),
			Direction: string(r.Direction), SessionID: r.SessionID, MethodName: r.MethodName, ToolName: r.ToolName,
			CallerIdentity: r.CallerIdentity, Outcome: string(r.Outcome), DurationMS: r.DurationMS,
			ErrorText: r.ErrorText, ArgBytes: r.ArgBytes,
		})
	}
	return ListMCPCallsResponse{Records: out, Total: total}, nil
}
