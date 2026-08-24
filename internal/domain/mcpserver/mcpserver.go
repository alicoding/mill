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
	"strings"
	"time"

	"github.com/alicoding/mill/internal/domain/seedorigin"
	"github.com/alicoding/mill/internal/domain/typedfield"
)

// VaultRefPrefix marks an Env value as a vault entry reference rather
// than a literal -- "KEY=vault:<entry-id>". Exported so the resolving
// service (configuresvc) and any future consumer share one spelling.
const VaultRefPrefix = "vault:"

// EnvVaultRef reports whether value (an Env entry's own value half,
// after the "KEY=" split) names a vault entry, returning its id.
func EnvVaultRef(value string) (id string, ok bool) {
	rest, found := strings.CutPrefix(value, VaultRefPrefix)
	return rest, found
}

// MCPServer is one reusable, named MCP server connection -- Command is
// run with Args over stdio (mcp.CommandTransport, wrapped by
// internal/adapters/mcpclient) each time a workflow resolves it.
type MCPServer struct {
	ID      string
	Label   string
	Command string
	Args    []string
	// Env is the child process's own environment additions, KEY=VALUE
	// per entry (execenv.ExecEnv.Env's own shape) -- merged onto Mill's
	// ambient environment at spawn (unlike ExecEnv's fully-explicit
	// posture: an MCP server subprocess still needs PATH etc. to run at
	// all). A value of the form "vault:<entry-id>" (goal 0185 S3) is
	// resolved to that vault entry's password at spawn time, never
	// written to disk in resolved form -- the MCP spec's own delivery
	// contract ("retrieve credentials from the environment"), Mill's
	// storage answer for the client side it leaves unspecified.
	Env []string
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

// Fields declares MCPServer's scalar editable shape (docs/adr/0029) --
// Args is deliberately excluded: it's a repeated argument list (a
// multi-row add/remove editor), not a single "name + typed value"
// wire string, so it stays its own dedicated editor
// (ConfigureMCPServers.tsx) outside the generic entity-field renderer
// -- the same carve-out NodeConfigFields.tsx already applies to
// non-scalar fields like mcp-tool-call's own argumentsJSON.
var Fields = []typedfield.Field{
	{Key: "label", Label: "Label", Type: typedfield.TypeText, Required: true},
	{Key: "command", Label: "Command", Type: typedfield.TypeText, Required: true,
		Description: "Run over stdio, e.g. a locally installed MCP server binary."},
}

var requiredMessages = map[string]string{
	"label":   "an MCP server needs a label",
	"command": "an MCP server needs a command",
}

// Validate checks an MCPServer is well-formed before it's persisted --
// same "never store an unconfigured/invalid value" discipline
// internal/domain/connector's own Validate already applies.
func Validate(s MCPServer) error {
	values := map[string]string{"label": s.Label, "command": s.Command}
	return typedfield.ValidateRequired(Fields, values, requiredMessages)
}
