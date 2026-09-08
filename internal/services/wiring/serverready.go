package wiring

import (
	"context"
	"fmt"
	"log/slog"
	"net"
	"os"
	"strconv"
)

// serverPortEnvVar is Wails3's own server-mode override (vendored
// pkg/application, build tag "server"): its own port parser rejects
// "0" (validated as 1-65535) and silently falls back to 8080, so this
// env var alone can't request an OS-assigned port -- the vendored
// listener never exposes a `:0`/listener-injection door either.
// announceServerReady resolves the request itself, before the vendored
// code ever reads the var: probe-bind a loopback port, close it
// immediately, and hand the vendored server the concrete number it
// will bind moments later inside app.Run(). The desktop build never
// sets this env var, so this path only ever runs under the e2e harness
// (frontend/e2e/fixtures/server.ts).
const serverPortEnvVar = "WAILS_SERVER_PORT"

// announceServerReady resolves serverPortEnvVar's OS-assignment
// request, if any, and -- only then -- prints the single
// machine-readable line spawnMillServer parses to learn this process's
// real bound ports (goal 0358 S6): `MILL_READY addr=host:port
// mcp=host:port`. mcpAddr is MillMCPService.BoundAddr(), the address it
// actually bound (which itself may have resolved from a requested port
// 0). A probe-bind failure is logged, not fatal: main.go's caller has
// already wired everything else the desktop path needs regardless.
func announceServerReady(mcpAddr string, logger *slog.Logger) {
	raw := os.Getenv(serverPortEnvVar)
	if raw != "0" && raw != ":0" {
		return
	}
	port, err := freeLoopbackPort()
	if err != nil {
		logger.Error("prepare OS-assigned server port", "error", err)
		return
	}
	if err := os.Setenv(serverPortEnvVar, strconv.Itoa(port)); err != nil {
		logger.Error("set OS-assigned server port", "error", err)
		return
	}
	fmt.Printf("MILL_READY addr=127.0.0.1:%d mcp=%s\n", port, mcpAddr)
}

// freeLoopbackPort binds port 0 (the OS picks a free one), reads it
// back via Addr(), and releases it immediately -- the standard
// probe-then-release workaround for handing a concrete port to a
// library that can't bind `:0` itself. A tiny TOCTOU window exists
// between the close here and the vendored server's own later bind;
// unlike a fixed port shared by every worktree, the window is
// microseconds wide and the port is never announced to a second
// process.
func freeLoopbackPort() (int, error) {
	var lc net.ListenConfig
	ln, err := lc.Listen(context.Background(), "tcp", "127.0.0.1:0")
	if err != nil {
		return 0, err
	}
	defer func() { _ = ln.Close() }()
	tcpAddr, ok := ln.Addr().(*net.TCPAddr)
	if !ok {
		return 0, fmt.Errorf("unexpected listener address type %T", ln.Addr())
	}
	return tcpAddr.Port, nil
}
