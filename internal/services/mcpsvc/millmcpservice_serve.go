package mcpsvc

import (
	"context"
	"fmt"
	"time"

	"github.com/alicoding/mill/internal/adapters/mcpserving"
)

// Start binds addr and begins serving in the background. Loopback-only
// by convention of the caller (main.go), not enforced here -- see
// mcpserving.Serve's own doc comment for why this function has no
// opinion on addr. addr's port may be 0 (an OS-assigned e2e port, goal
// 0358 S6) -- BoundAddr reports what actually got bound.
func (m *MillMCPService) Start(addr string) error {
	httpServer, boundAddr, errCh, err := mcpserving.Serve(addr, m.server)
	if err != nil {
		return fmt.Errorf("mcp server: %w", err)
	}
	m.http = httpServer
	m.boundAddr = boundAddr.String()
	select {
	case err := <-errCh:
		return fmt.Errorf("mcp server: %w", err)
	case <-time.After(100 * time.Millisecond):
		return nil
	}
}

// BoundAddr returns the address Start actually bound -- see the
// boundAddr field's own doc comment.
func (m *MillMCPService) BoundAddr() string {
	return m.boundAddr
}

//wails:ignore
func (m *MillMCPService) Shutdown(ctx context.Context) error {
	if m.http == nil {
		return nil
	}
	return m.http.Shutdown(ctx)
}
