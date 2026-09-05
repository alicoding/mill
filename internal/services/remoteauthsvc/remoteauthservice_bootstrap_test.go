package remoteauthsvc

import (
	"bytes"
	"log/slog"
	"net/http"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"github.com/alicoding/mill/internal/adapters/settings"
)

// newTestServiceWithLog is newTestService's sibling for the bootstrap
// tests below: a real slog.Logger backed by a buffer, so assertions
// read the log SINK (what a filesystem-reading owner would actually
// see) rather than scraping process stdout.
func newTestServiceWithLog(t *testing.T) (*RemoteAuthService, *bytes.Buffer) {
	t.Helper()
	store, err := settings.New(filepath.Join(t.TempDir(), "settings.json"))
	if err != nil {
		t.Fatalf("settings.New() = %v, want nil error", err)
	}
	var buf bytes.Buffer
	logger := slog.New(slog.NewTextHandler(&buf, nil))
	return New(store, logger), &buf
}

// pairingCodeInLog extracts the code from a log line shaped like
// GeneratePairingCode's ("code=XXXXXXXX"), or fails the test if none
// is present.
func pairingCodeInLog(t *testing.T, log string) string {
	t.Helper()
	m := regexp.MustCompile(`code=([A-Z0-9]{8})`).FindStringSubmatch(log)
	if m == nil {
		t.Fatalf("log = %q, want a code=XXXXXXXX pairing code line", log)
	}
	return m[1]
}

// TestBootstrapPairingCode_ServerModeZeroDevices_LogsUsableCode pins
// SLICE 1b's fix: a server-mode instance with nothing paired yet
// mints and logs a code purely from construction, with no RPC call
// required -- the deadlock this closes is that an RPC call is exactly
// what an unpaired non-loopback-bound instance can never make.
func TestBootstrapPairingCode_ServerModeZeroDevices_LogsUsableCode(t *testing.T) {
	s, buf := newTestServiceWithLog(t)

	s.BootstrapPairingCode(true)

	code := pairingCodeInLog(t, buf.String())

	handler := s.Middleware()(appHandler())
	rec := submitCode(t, handler, "203.0.113.20:1", code)
	if rec.Code != http.StatusSeeOther {
		t.Fatalf("pairing with the logged code: status = %d, want 303 (a usable code)", rec.Code)
	}
}

// TestBootstrapPairingCode_OnePairedDevice_LogsNothing pins the other
// half: once a device is paired, restart-time bootstrap must not mint
// or log a fresh code -- the deadlock only exists before the first
// device pairs.
func TestBootstrapPairingCode_OnePairedDevice_LogsNothing(t *testing.T) {
	s, buf := newTestServiceWithLog(t)
	if _, err := s.mintDevice("Existing Device", "", KindDevice); err != nil {
		t.Fatalf("mintDevice() = %v, want nil error", err)
	}

	s.BootstrapPairingCode(true)

	if strings.Contains(buf.String(), "pairing code generated") {
		t.Fatalf("log = %q, want no pairing-code log once a device is paired", buf.String())
	}
}

// TestBootstrapPairingCode_DesktopMode_NeverAutoLogs pins the desktop
// side of the decision: desktop builds already have a loopback-
// reachable Settings > Remote access path regardless of pairing
// state, so bootstrap must stay a no-op there even with zero devices
// paired -- auto-minting on every desktop launch would just be log
// noise for a path desktop mode never needs.
func TestBootstrapPairingCode_DesktopMode_NeverAutoLogs(t *testing.T) {
	s, buf := newTestServiceWithLog(t)

	s.BootstrapPairingCode(false)

	if buf.String() != "" {
		t.Fatalf("log = %q, want nothing logged in desktop mode", buf.String())
	}
	s.mu.Lock()
	hasCode := s.code != nil
	s.mu.Unlock()
	if hasCode {
		t.Fatalf("desktop mode must not mint a code nobody can read")
	}
}

// TestBootstrapPairingCode_RefreshesEachStartupWhileUnpaired pins
// SLICE 1b's "refresh it on each startup" requirement: two successive
// bootstrap calls against the same still-unpaired instance (modeling
// two process restarts) each log their own usable code, and the
// earlier one stops working once the newer one has been issued
// (single live code at a time, same invariant GeneratePairingCode
// already holds).
func TestBootstrapPairingCode_RefreshesEachStartupWhileUnpaired(t *testing.T) {
	s, buf := newTestServiceWithLog(t)

	s.BootstrapPairingCode(true)
	firstCode := pairingCodeInLog(t, buf.String())

	buf.Reset()
	s.BootstrapPairingCode(true)
	secondCode := pairingCodeInLog(t, buf.String())

	if firstCode == secondCode {
		t.Fatalf("two bootstrap calls produced the same code %q, want a fresh one each restart", firstCode)
	}

	handler := s.Middleware()(appHandler())
	stale := submitCode(t, handler, "203.0.113.21:1", firstCode)
	if stale.Code != http.StatusUnauthorized {
		t.Fatalf("pairing with the stale first code: status = %d, want 401", stale.Code)
	}
	fresh := submitCode(t, handler, "203.0.113.21:2", secondCode)
	if fresh.Code != http.StatusSeeOther {
		t.Fatalf("pairing with the refreshed code: status = %d, want 303", fresh.Code)
	}
}

// TestBootstrapPairingCode_LoggedCodeIsSingleUse extends the usable-
// code proof above: the code the log carries pairs successfully
// exactly once, same as any other pairing code.
func TestBootstrapPairingCode_LoggedCodeIsSingleUse(t *testing.T) {
	s, buf := newTestServiceWithLog(t)
	s.BootstrapPairingCode(true)
	code := pairingCodeInLog(t, buf.String())

	handler := s.Middleware()(appHandler())
	first := submitCode(t, handler, "203.0.113.22:1", code)
	if first.Code != http.StatusSeeOther {
		t.Fatalf("first use: status = %d, want 303", first.Code)
	}
	second := submitCode(t, handler, "203.0.113.22:2", code)
	if second.Code != http.StatusUnauthorized {
		t.Fatalf("second use of the same logged code: status = %d, want 401", second.Code)
	}
}

// TestGeneratePairingCode_NoLogOnceADeviceIsPaired pins the general
// form of SLICE 1b's "never log the code once paired": the gate
// applies to every caller of GeneratePairingCode, not only the
// startup bootstrap path -- a desktop owner pairing a second device
// from Settings must not have that code land in the log either.
func TestGeneratePairingCode_NoLogOnceADeviceIsPaired(t *testing.T) {
	s, buf := newTestServiceWithLog(t)
	if _, err := s.mintDevice("Existing Device", "", KindDevice); err != nil {
		t.Fatalf("mintDevice() = %v, want nil error", err)
	}

	info, err := s.GeneratePairingCode()
	if err != nil {
		t.Fatalf("GeneratePairingCode() = %v, want nil error", err)
	}
	if info.Code == "" {
		t.Fatalf("GeneratePairingCode() must still return a usable code for the Settings UI")
	}
	if strings.Contains(buf.String(), "pairing code generated") {
		t.Fatalf("log = %q, want no pairing-code log once a device is paired", buf.String())
	}
}

// TestGeneratePairingCode_LogsWhenUnpaired pins the positive
// counterpart directly against GeneratePairingCode (not just via
// BootstrapPairingCode), confirming the manual desktop-triggered path
// still logs a usable code while nothing is paired yet.
func TestGeneratePairingCode_LogsWhenUnpaired(t *testing.T) {
	s, buf := newTestServiceWithLog(t)

	if _, err := s.GeneratePairingCode(); err != nil {
		t.Fatalf("GeneratePairingCode() = %v, want nil error", err)
	}

	pairingCodeInLog(t, buf.String())
}
