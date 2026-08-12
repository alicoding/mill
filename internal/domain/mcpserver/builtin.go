package mcpserver

import "github.com/alicoding/mill/internal/domain/seedorigin"

// ExampleReferenceServerID is the seeded example MCP Server's ID --
// exported so composition.BuiltInWorkflows' own mcp-tool-call seed
// (nodetypes.go) can reference it without a string literal that could
// drift, same pattern httprequest.ExampleNoneID/list.ExampleCountryCodesID
// already establish.
const ExampleReferenceServerID = "example-reference-mcpserver"

// BuiltIn returns the seeded example MCP Server -- pure config, no
// persistence (mirrors httprequest.BuiltIn/list.BuiltIn's shape: this
// package stays free of the settings-store concern, per CLAUDE.md's
// backend rule -- ConfigureService owns seeding/top-up).
//
// Points at the official MCP reference server (@modelcontextprotocol/
// server-everything) via npx -- the same real subprocess docs/SPEC.md
// §3.6 already verified live end to end (its "echo" tool, called with
// {"message":"hello from mill"} -> "Echo: hello from mill"). A real
// user with Node/npx installed gets a genuinely working example; the
// committed test suite never spawns it (docs/goals/0010 item 5 -- Go
// tests use an in-process/in-memory MCP transport instead, and the e2e
// suite only asserts this seed's presence/config, never a live call --
// mcp-tool-editor.spec.ts already covers a real spawned-subprocess call
// against its own local fixture server).
func BuiltIn() []MCPServer {
	return []MCPServer{
		{
			ID:      ExampleReferenceServerID,
			Label:   "Example: Reference server (npx)",
			Command: "npx",
			Args:    []string{"-y", "@modelcontextprotocol/server-everything"},
			BuiltIn: true,
			Seed:    seedorigin.Stamp(1),
		},
	}
}
