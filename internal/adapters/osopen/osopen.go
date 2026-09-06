package osopen

import (
	"errors"
	"os"
	"sync"
	"testing"
)

// ErrUnsupportedInServerMode is what Open/Reveal return in a server
// build, where there is no desktop to open anything on. Declared
// outside the build tags so a desktop caller can name it in a test
// or a branch (pluginsvc maps it to "approved, not performed").
var ErrUnsupportedInServerMode = errors.New("opening files or URLs is unsupported in server mode")

// Port is the "open a URL in the system's default browser" operation
// Mill's own bound service door (AtlasService.OpenURL) depends on --
// Host (the real OS opener, its OpenURL implemented per build tag in
// osopen_desktop.go/osopen_server.go) and Memory (an in-memory
// recorder, memory.go) both implement it in full, so a caller never
// knows or cares which one it holds. Same shape as
// internal/adapters/clipboard.Port (goal 0356 part 1) and
// internal/adapters/credential.Store, applied to the third instance of
// the same defect class: a test or an e2e-spawned server must never
// reach the host's real browser.
type Port interface {
	OpenURL(url string) error
}

var (
	hostOnce sync.Once
	hostInst *Host

	memOnce sync.Once
	memInst *Memory
)

// New returns the Port the current process should use: MILL_OPEN picks
// explicitly ("host" or "memory"); left unset, a `go test` binary gets
// Memory (testing.Testing() is true from the first line any test binary
// runs) and every other binary -- the real app, or an e2e spec's
// spawned bin/mill-server, which is a normal build, not a test binary
// -- gets Host. An e2e server must set MILL_OPEN=memory explicitly
// (frontend/e2e/fixtures/server.ts), since testing.Testing() can't see
// it. New always returns the SAME instance within one process.
func New() Port {
	switch os.Getenv("MILL_OPEN") {
	case "memory":
		return ForTests()
	case "host":
		return sharedHost()
	default:
		if testing.Testing() {
			return ForTests()
		}
		return sharedHost()
	}
}

// ForTests returns the process-wide in-memory Port, regardless of
// MILL_OPEN -- the explicit seam for a test that wants Memory without
// depending on New's own environment-driven default, and the same
// instance DebugOpenedURLs reads back.
func ForTests() Port {
	memOnce.Do(func() { memInst = NewMemory() })
	return memInst
}

func sharedHost() Port {
	hostOnce.Do(func() { hostInst = NewHost() })
	return hostInst
}

// DebugOpenedURLs returns every URL the process-wide in-memory Port has
// recorded (ForTests(), capped at memoryCap, oldest first) --
// AtlasService.DebugLastOpenedURLs gates this to MILL_OPEN=memory
// before exposing it over the wire, so a spec can never call it
// expecting a Host it didn't get.
func DebugOpenedURLs() []string {
	return ForTests().(*Memory).OpenedURLs()
}

// Host is the real OS opener. OpenURL's own implementation is per
// build tag (osopen_desktop.go: Wails' own Browser.OpenURL, reached
// through internal/adapters/windowing, the sole port onto
// pkg/application; osopen_server.go: always
// ErrUnsupportedInServerMode, the same posture Open/Reveal already
// hold under -tags server -- no server build, the phone LaunchAgent
// included, has ever had a desktop browser to open a URL in).
type Host struct{}

// NewHost constructs the real OS-opener adapter. Panics if called from
// inside a `go test` binary (testing.Testing()) unless the caller has
// set MILL_OPEN_HOST_OK=1 first -- goal 0356 part 2's own guard,
// closing the same defect class clipboard.NewHost already closed for
// the pasteboard: a test that reaches this constructor by accident
// must never silently open a real browser tab on the machine running
// it.
func NewHost() *Host {
	if testing.Testing() && os.Getenv("MILL_OPEN_HOST_OK") != "1" {
		panic("osopen: refusing to construct the real OS-opener adapter inside a go test binary; set MILL_OPEN_HOST_OK=1 for a deliberate real-open test")
	}
	return &Host{}
}
