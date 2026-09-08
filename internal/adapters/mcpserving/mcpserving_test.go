package mcpserving

import (
	"net"
	"testing"
	"time"
)

// Serve binding "127.0.0.1:0" (goal 0358 S6's OS-assigned e2e ports)
// returns the real bound address via net.Addr, not the requested "0"
// port -- the contract MillMCPService.Start/BoundAddr and, in turn,
// wiring.announceServerReady's MILL_READY line depend on.
func TestServe_OSAssignedPortReturnsRealBoundAddr(t *testing.T) {
	server := New("test", "0.0.0", "")
	httpServer, addr, errCh, err := Serve("127.0.0.1:0", server)
	if err != nil {
		t.Fatalf("Serve: %v", err)
	}
	t.Cleanup(func() {
		if err := httpServer.Close(); err != nil {
			t.Errorf("closing http.Server: %v", err)
		}
	})

	tcpAddr, ok := addr.(*net.TCPAddr)
	if !ok {
		t.Fatalf("addr is %T, want *net.TCPAddr", addr)
	}
	if tcpAddr.Port == 0 {
		t.Fatalf("Serve bound port 0, want a real assigned port")
	}

	select {
	case err := <-errCh:
		t.Fatalf("errCh delivered %v within the settle window, want no error", err)
	case <-time.After(50 * time.Millisecond):
	}
}

// An unparseable addr fails synchronously (net.Listen's own error),
// never silently deferred to the async error channel the way
// http.Server.ListenAndServe's bind failure used to be.
func TestServe_InvalidAddrFailsSynchronously(t *testing.T) {
	server := New("test", "0.0.0", "")
	httpServer, addr, errCh, err := Serve("not-a-valid-addr", server)
	if err == nil {
		t.Fatalf("Serve(%q) returned no error, want one", "not-a-valid-addr")
	}
	if httpServer != nil || addr != nil || errCh != nil {
		t.Fatalf("Serve returned non-nil results alongside an error: httpServer=%v addr=%v errCh=%v", httpServer, addr, errCh)
	}
}
