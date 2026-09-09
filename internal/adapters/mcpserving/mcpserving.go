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
	"context"
	"net"
	"net/http"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// readHeaderTimeout bounds how long the server waits to read a request's
// headers -- a real gosec finding (G112), not a false positive: even a
// loopback-only listener is reachable by any other local process, and an
// http.Server with no ReadHeaderTimeout is vulnerable to a slow-headers
// (Slowloris-style) connection-exhaustion attack from one such process.
const readHeaderTimeout = 5 * time.Second

// New constructs an MCP server with the given name/version identity
// and an onboarding instructions string (goal 0160: the MCP spec's own
// ServerOptions.Instructions field, a pointer to the fuller
// mill://skill resource rather than a manual repeated here). Thin on
// purpose otherwise -- there's little to wrap here (the SDK's
// *mcp.Server already has the right shape), this exists for the import
// boundary the ports/adapters rule wants, not to hide meaningful logic.
//
// middleware is applied via AddReceivingMiddleware (goal 0159 slice 1:
// the MCP call audit trail's server-side recording point) -- optional,
// so a caller with nothing to observe yet (a test server) passes none.
func New(name, version, instructions string, middleware ...mcp.Middleware) *mcp.Server {
	server := mcp.NewServer(&mcp.Implementation{Name: name, Version: version}, &mcp.ServerOptions{Instructions: instructions})
	if len(middleware) > 0 {
		server.AddReceivingMiddleware(middleware...)
	}
	return server
}

// Serve binds addr itself (net.Listen, rather than delegating the bind
// to http.Server.ListenAndServe) so the caller can read back the real
// bound address via the returned net.Addr -- required when addr's port
// is 0 (goal 0358 S6's OS-assigned e2e ports), since ListenAndServe
// never exposes what an ephemeral bind resolved to. The bind itself is
// synchronous (a failure returns immediately, addr's syntax errors
// included); serving then runs in a background goroutine (Serve
// blocks), whose own later failure still reports async via the
// returned error channel (capacity 1). Binding wider than loopback is
// entirely the caller's own explicit choice -- this function has no
// opinion on addr and doesn't default to 127.0.0.1 itself.
func Serve(addr string, server *mcp.Server) (*http.Server, net.Addr, <-chan error, error) {
	var lc net.ListenConfig
	ln, err := lc.Listen(context.Background(), "tcp", addr)
	if err != nil {
		return nil, nil, nil, err
	}
	handler := mcp.NewStreamableHTTPHandler(func(*http.Request) *mcp.Server { return server }, nil)
	httpServer := &http.Server{Handler: handler, ReadHeaderTimeout: readHeaderTimeout}
	errCh := make(chan error, 1)
	go func() {
		if err := httpServer.Serve(ln); err != nil && err != http.ErrServerClosed {
			errCh <- err
		}
	}()
	return httpServer, ln.Addr(), errCh, nil
}
