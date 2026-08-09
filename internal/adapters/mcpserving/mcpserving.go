// Package mcpserving wraps modelcontextprotocol/go-sdk's server role
// behind Mill's own names, per CLAUDE.md's ports/adapters rule --
// mirrors internal/adapters/mcpclient's shape for the SDK's other role
// (Mill as MCP client, §3.6). This is the new role: Mill as MCP
// SERVER, exposing its own workflows/Configure data as Resources
// (docs/SPEC.md §11's task, distinct from and not reopening §3.1's
// still-disputed MCP-*host* question -- no LLM/agent loop runs inside
// Mill here, this is one HTTP endpoint an external agent's own host
// connects to and reads, structurally the same shape as
// internal/adapters/httpconnector being an HTTP client: a protocol
// implementation, not a decision-maker).
package mcpserving

import (
	"net/http"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// New constructs an MCP server with the given name/version identity.
// Thin on purpose -- there's little to wrap here (the SDK's
// *mcp.Server already has the right shape), this exists for the import
// boundary the ports/adapters rule wants, not to hide meaningful logic.
func New(name, version string) *mcp.Server {
	return mcp.NewServer(&mcp.Implementation{Name: name, Version: version}, nil)
}

// Serve starts server listening on addr via the SDK's own streamable-
// HTTP transport, in a background goroutine (ListenAndServe blocks, so
// this can't run synchronously in a startup path). Binding wider than
// loopback is entirely the caller's own explicit choice -- this
// function has no opinion on addr and doesn't default to 127.0.0.1
// itself. Returns the *http.Server so the caller can Shutdown it later,
// and a buffered error channel (capacity 1) that receives a bind
// failure, since that happens asynchronously after this function has
// already returned.
func Serve(addr string, server *mcp.Server) (*http.Server, <-chan error) {
	handler := mcp.NewStreamableHTTPHandler(func(*http.Request) *mcp.Server { return server }, nil)
	httpServer := &http.Server{Addr: addr, Handler: handler}
	errCh := make(chan error, 1)
	go func() {
		if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			errCh <- err
		}
	}()
	return httpServer, errCh
}
