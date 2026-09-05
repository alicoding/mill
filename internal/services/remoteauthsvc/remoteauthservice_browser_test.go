package remoteauthsvc

import (
	"log/slog"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/alicoding/mill/internal/adapters/settings"
	"github.com/alicoding/mill/internal/domain/usererror"
)

func newBrowserTestService(t *testing.T) *RemoteAuthService {
	t.Helper()
	store, err := settings.New(filepath.Join(t.TempDir(), "settings.json"))
	if err != nil {
		t.Fatalf("settings.New() = %v, want nil error", err)
	}
	return New(store, slog.New(slog.DiscardHandler))
}

// TestPairBrowser_UsesTheSameCodeRules pins that a browser pairs
// through the one pairing-code lifecycle, not a second trust model:
// the live code works once, and is spent afterwards.
func TestPairBrowser_UsesTheSameCodeRules(t *testing.T) {
	s := newBrowserTestService(t)
	info, err := s.GeneratePairingCode()
	if err != nil {
		t.Fatalf("GeneratePairingCode() = %v, want nil error", err)
	}

	pairing, err := s.PairBrowser(info.Code, "Chrome on this Mac", "127.0.0.1")
	if err != nil {
		t.Fatalf("PairBrowser(live code) = %v, want nil error", err)
	}
	if pairing.Token == "" || pairing.DeviceID == "" {
		t.Fatalf("PairBrowser() = %+v, want a token and an id", pairing)
	}
	if pairing.Label != "Chrome on this Mac" {
		t.Fatalf("label = %q, want the announced one", pairing.Label)
	}

	if _, err := s.PairBrowser(info.Code, "Second try", "127.0.0.1"); err == nil {
		t.Fatalf("PairBrowser(spent code) = nil error, want a refusal")
	}
}

// TestPairBrowser_BadCodeCarriesItsSentence pins the declared code and
// the one sentence the extension shows.
func TestPairBrowser_BadCodeCarriesItsSentence(t *testing.T) {
	s := newBrowserTestService(t)
	if _, err := s.GeneratePairingCode(); err != nil {
		t.Fatalf("GeneratePairingCode() = %v, want nil error", err)
	}
	_, err := s.PairBrowser("WRONGCOD", "Chrome", "127.0.0.1")
	declared, ok := usererror.Of(err)
	if !ok || declared.Code != CodeBadPairingCode {
		t.Fatalf("PairBrowser(wrong code) = %v, want code %q", err, CodeBadPairingCode)
	}
	if !usererror.ValidMessage(declared.Message) {
		t.Fatalf("message %q is not one user-facing sentence", declared.Message)
	}
}

// TestPairBrowser_LocksOutAGuessingLoop pins that a scripted caller
// hits the same per-source lockout a hand-typed one does.
func TestPairBrowser_LocksOutAGuessingLoop(t *testing.T) {
	s := newBrowserTestService(t)
	if _, err := s.GeneratePairingCode(); err != nil {
		t.Fatalf("GeneratePairingCode() = %v, want nil error", err)
	}
	var last error
	for i := 0; i <= maxFailuresBeforeLockout; i++ {
		_, last = s.PairBrowser("WRONGCOD", "Chrome", "10.0.0.9")
	}
	declared, ok := usererror.Of(last)
	if !ok || declared.Code != CodePairingLockedOut {
		t.Fatalf("after %d wrong codes the error was %v, want code %q", maxFailuresBeforeLockout+1, last, CodePairingLockedOut)
	}
}

// TestBrowserToken_NeverCrossesIntoAppAccess pins the kind boundary:
// a browser's bearer token is not an app-access credential, and a
// phone's token is not a bridge credential.
func TestBrowserToken_NeverCrossesIntoAppAccess(t *testing.T) {
	s := newBrowserTestService(t)
	info, err := s.GeneratePairingCode()
	if err != nil {
		t.Fatalf("GeneratePairingCode() = %v, want nil error", err)
	}
	pairing, err := s.PairBrowser(info.Code, "Chrome", "127.0.0.1")
	if err != nil {
		t.Fatalf("PairBrowser() = %v, want nil error", err)
	}

	if _, ok := s.ValidateBrowserToken(pairing.Token); !ok {
		t.Fatalf("ValidateBrowserToken(its own token) = false, want true")
	}
	s.mu.Lock()
	_, appOK := s.validateToken(pairing.Token, "", KindDevice, timeNow())
	s.mu.Unlock()
	if appOK {
		t.Fatalf("a browser's bearer token validated as an app-access device token")
	}

	s.mu.Lock()
	deviceToken, err := s.mintDevice("Phone", "", KindDevice)
	s.mu.Unlock()
	if err != nil {
		t.Fatalf("mintDevice() = %v, want nil error", err)
	}
	if _, ok := s.ValidateBrowserToken(deviceToken); ok {
		t.Fatalf("a phone's token validated as a browser token")
	}
}

// TestListDevices_AndListBrowsers_NeverMix pins that Settings' two
// sections read two disjoint lists.
func TestListDevices_AndListBrowsers_NeverMix(t *testing.T) {
	s := newBrowserTestService(t)
	info, err := s.GeneratePairingCode()
	if err != nil {
		t.Fatalf("GeneratePairingCode() = %v, want nil error", err)
	}
	if _, err := s.PairBrowser(info.Code, "Chrome", "127.0.0.1"); err != nil {
		t.Fatalf("PairBrowser() = %v, want nil error", err)
	}
	s.mu.Lock()
	_, err = s.mintDevice("Phone", "", KindDevice)
	s.mu.Unlock()
	if err != nil {
		t.Fatalf("mintDevice() = %v, want nil error", err)
	}

	browsers := s.ListBrowsers()
	if len(browsers) != 1 || browsers[0].Label != "Chrome" || browsers[0].Kind != KindBrowser {
		t.Fatalf("ListBrowsers() = %+v, want exactly the paired browser", browsers)
	}
	devices := s.ListDevices()
	if len(devices) != 1 || devices[0].Label != "Phone" {
		t.Fatalf("ListDevices() = %+v, want exactly the paired phone", devices)
	}
}

// TestPairBrowser_RevokeEndsIt pins that Settings' Revoke is the
// un-pairing path for a browser exactly as it is for a device.
func TestPairBrowser_RevokeEndsIt(t *testing.T) {
	s := newBrowserTestService(t)
	info, _ := s.GeneratePairingCode()
	pairing, err := s.PairBrowser(info.Code, "Chrome", "127.0.0.1")
	if err != nil {
		t.Fatalf("PairBrowser() = %v, want nil error", err)
	}
	if err := s.RevokeDevice(pairing.DeviceID); err != nil {
		t.Fatalf("RevokeDevice() = %v, want nil error", err)
	}
	if _, ok := s.ValidateBrowserToken(pairing.Token); ok {
		t.Fatalf("a revoked browser's token still validates")
	}
	if len(s.ListBrowsers()) != 0 {
		t.Fatalf("ListBrowsers() after revoke = %v, want empty", s.ListBrowsers())
	}
}

// TestBrowserLabel_NeverBlankNeverUnbounded pins the two ends a
// Settings row depends on.
func TestBrowserLabel_NeverBlankNeverUnbounded(t *testing.T) {
	if got := browserLabel("   "); got != browserLabelFallback {
		t.Fatalf("browserLabel(blank) = %q, want %q", got, browserLabelFallback)
	}
	long := strings.Repeat("x", deviceLabelMaxLen+40)
	if got := browserLabel(long); len(got) != deviceLabelMaxLen {
		t.Fatalf("browserLabel(long) length = %d, want %d", len(got), deviceLabelMaxLen)
	}
}

// timeNow keeps the kind-boundary test reading like the production
// call site, which always passes the current clock.
func timeNow() time.Time { return time.Now() }
