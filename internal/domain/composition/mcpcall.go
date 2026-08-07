package composition

import "fmt"

// ResolvedMCPServer is an MCP Server's connection config, assembled by
// whatever owns MCPServer storage at request time. Same shape and
// reasoning as ResolvedConnector (integration.go): composition.go
// doesn't own MCPServer persistence (ConfigureService does), so this is
// injected once via SetMCPServerLookup rather than composition
// depending on ConfigureService directly.
type ResolvedMCPServer struct {
	Command string
	Args    []string
}

// lookupMCPServerFn defaults to erroring so an mcp-tool-call node run
// before ConfigureService exists (or before SetMCPServerLookup wires it)
// fails loudly instead of silently no-op'ing.
var lookupMCPServerFn = func(mcpServerID string) (ResolvedMCPServer, error) {
	return ResolvedMCPServer{}, fmt.Errorf("no MCP server lookup registered (yet) for id %q", mcpServerID)
}

// SetMCPServerLookup wires the function mcp-tool-call nodes use to
// resolve an mcpServerId into its command/args. Called once from
// main.go once ConfigureService exists.
func SetMCPServerLookup(fn func(mcpServerID string) (ResolvedMCPServer, error)) {
	lookupMCPServerFn = fn
}
