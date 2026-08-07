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
)

// MCPServer is one reusable, named MCP server connection -- Command is
// run with Args over stdio (mcp.CommandTransport, wrapped by
// internal/adapters/mcpclient) each time a workflow resolves it.
type MCPServer struct {
	ID      string
	Label   string
	Command string
	Args    []string
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
