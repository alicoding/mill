// Package mcpserver holds the core-domain shape of an MCP Server
// (docs/SPEC.md §3.6): a reusable (1:many), Configure-authored
// connection to a local, stdio-based MCP server -- the entity a
// workflow's mcp-tool-call node resolves via ID to know which server's
// tools it can call. Per CLAUDE.md's core-domain rule, the shape and
// its validation stay hand-written -- no library has an opinion on
// Mill's own MCP Server model. Simpler than internal/domain/connector:
// stdio is local-process trust, not a network call, so there's no
// AuthType/Headers concept here at all.
package mcpserver

import (
	"fmt"
	"strings"
	"time"

	"github.com/alicoding/mill/internal/domain/seedorigin"
)

// MCPServer is one reusable, named MCP server connection -- Command is
// run with Args over stdio (mcp.CommandTransport, wrapped by
// internal/adapters/mcpclient) each time a workflow resolves it.
type MCPServer struct {
	ID      string
	Label   string
	Command string
	Args    []string
	// BuiltIn marks a seeded example MCP Server (BuiltIn() below) --
	// purely informational, same as httprequest.HTTPRequest.BuiltIn/
	// decision.Decision.BuiltIn/list.List.BuiltIn: drives a "built-in"
	// badge only, never gates Edit/Delete.
	BuiltIn bool
	// CreatedAt/UpdatedAt are system-managed audit timestamps (SPEC.md
	// §3.2.2's reserved-column pattern), stamped server-side at every
	// persisted mutation (ConfigureService), never trusted from the
	// wire. Zero value means pre-timestamp data -- migration-free.
	CreatedAt time.Time
	UpdatedAt time.Time
	// Seed is this MCP server's seed provenance (docs/goals/0037) --
	// zero value means "not of seed origin," migration-free. See
	// composition.Workflow.Seed's doc comment for the full reasoning.
	Seed seedorigin.Origin
}

// Validate checks an MCPServer is well-formed before it's persisted --
// same "never store an unconfigured/invalid value" discipline
// internal/domain/connector's own Validate already applies.
func Validate(s MCPServer) error {
	if strings.TrimSpace(s.Label) == "" {
		return fmt.Errorf("an MCP server needs a label")
	}
	if strings.TrimSpace(s.Command) == "" {
		return fmt.Errorf("an MCP server needs a command")
	}
	return nil
}
