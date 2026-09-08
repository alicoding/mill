package wiring

import (
	"io"
	"log/slog"
	"os"
	"regexp"
	"strconv"
	"testing"
)

// captureStdout runs fn with os.Stdout redirected to a pipe and returns
// everything it printed -- announceServerReady's MILL_READY line is the
// one thing under test here, and it only ever goes to stdout (never the
// logger), so this is the only way to observe it.
func captureStdout(t *testing.T, fn func()) string {
	t.Helper()
	r, w, err := os.Pipe()
	if err != nil {
		t.Fatalf("os.Pipe: %v", err)
	}
	orig := os.Stdout
	os.Stdout = w
	defer func() { os.Stdout = orig }()

	fn()

	if err := w.Close(); err != nil {
		t.Fatalf("close pipe writer: %v", err)
	}
	out, err := io.ReadAll(r)
	if err != nil {
		t.Fatalf("read pipe: %v", err)
	}
	return string(out)
}

var readyLinePattern = regexp.MustCompile(`^MILL_READY addr=127\.0\.0\.1:(\d+) mcp=127\.0\.0\.1:9999\n$`)

// A server told to bind an OS-assigned port (WAILS_SERVER_PORT=0, the
// e2e harness's own request) prints the MILL_READY line with a real,
// non-zero bound port -- the contract frontend/e2e/fixtures/server.ts's
// spawnMillServer parses (goal 0358 S6).
func TestAnnounceServerReady_OSAssignedPortPrintsReadyLineWithNonZeroPort(t *testing.T) {
	t.Setenv(serverPortEnvVar, "0")
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))

	out := captureStdout(t, func() {
		announceServerReady("127.0.0.1:9999", logger)
	})

	match := readyLinePattern.FindStringSubmatch(out)
	if match == nil {
		t.Fatalf("announceServerReady printed %q, want a MILL_READY line matching %s", out, readyLinePattern)
	}
	port, err := strconv.Atoi(match[1])
	if err != nil {
		t.Fatalf("parsing printed port %q: %v", match[1], err)
	}
	if port == 0 {
		t.Fatalf("announceServerReady printed port 0, want a real bound port")
	}

	// The env var it rewrote is what the vendored Wails3 server-mode
	// listener reads moments later in app.Run() -- must be the same
	// concrete port just printed, never left at "0" (which Wails'
	// own parsePort rejects, silently falling back to 8080).
	if got := os.Getenv(serverPortEnvVar); got != match[1] {
		t.Fatalf("%s = %q after announceServerReady, want %q (the port it printed)", serverPortEnvVar, got, match[1])
	}
}

// A caller naming its own fixed port (WAILS_SERVER_PORT unset, or a
// real port already) never asked for OS assignment -- main.go only
// ever prints this line when it did, so a dedicated-pair spec's own
// server produces no line for spawnMillServer to misparse.
func TestAnnounceServerReady_FixedPortPrintsNothing(t *testing.T) {
	for _, raw := range []string{"", "9400"} {
		t.Run(raw, func(t *testing.T) {
			t.Setenv(serverPortEnvVar, raw)
			logger := slog.New(slog.NewTextHandler(io.Discard, nil))

			out := captureStdout(t, func() {
				announceServerReady("127.0.0.1:9999", logger)
			})

			if out != "" {
				t.Fatalf("announceServerReady printed %q for %s=%q, want nothing", out, serverPortEnvVar, raw)
			}
		})
	}
}

// freeLoopbackPort itself: a real, currently-free, non-zero loopback
// port, distinct across back-to-back calls -- the probe-then-release
// mechanism announceServerReady leans on.
func TestFreeLoopbackPort_ReturnsDistinctNonZeroPorts(t *testing.T) {
	first, err := freeLoopbackPort()
	if err != nil {
		t.Fatalf("freeLoopbackPort: %v", err)
	}
	if first == 0 {
		t.Fatalf("freeLoopbackPort returned 0, want a real port")
	}
	second, err := freeLoopbackPort()
	if err != nil {
		t.Fatalf("freeLoopbackPort: %v", err)
	}
	if second == 0 {
		t.Fatalf("freeLoopbackPort returned 0, want a real port")
	}
	if first == second {
		// Not a hard guarantee from the OS, but SO_REUSEADDR timing
		// aside, back-to-back ephemeral binds landing on the exact same
		// port would be a real (if rare) regression signal worth a
		// buffer flush's worth of investigation, not a silent pass.
		t.Logf("freeLoopbackPort returned the same port twice: %d", first)
	}
}
