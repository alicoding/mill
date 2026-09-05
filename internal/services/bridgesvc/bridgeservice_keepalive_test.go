package bridgesvc

import (
	"bufio"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/alicoding/mill/internal/services/remoteauthsvc"
)

// revocableAuth flips from paired to revoked mid-stream. The flag is
// atomic because the test sets it while the stream's own goroutine is
// reading it.
type revocableAuth struct{ revoked atomic.Bool }

func (a *revocableAuth) PairBrowser(code, label, source string) (remoteauthsvc.BrowserPairing, error) {
	return remoteauthsvc.BrowserPairing{}, nil
}

func (a *revocableAuth) ValidateBrowserToken(token string) (remoteauthsvc.DeviceInfo, bool) {
	if a.revoked.Load() || token != "good" {
		return remoteauthsvc.DeviceInfo{}, false
	}
	return remoteauthsvc.DeviceInfo{ID: "browser-1", Label: "Chrome", Kind: remoteauthsvc.KindBrowser}, true
}

// TestEvents_KeepalivePingsAndClosesOnRevoke pins both jobs the
// keepalive does: an idle stream keeps receiving pings (which is what
// keeps a browser extension's service worker alive between commands),
// and a browser revoked in Settings loses its live stream on that same
// tick rather than surviving until it next reconnects.
//
// In-package so the interval can be shortened; the real interval is
// KeepaliveSeconds in the domain package.
func TestEvents_KeepalivePingsAndClosesOnRevoke(t *testing.T) {
	auth := &revocableAuth{}
	svc := New(auth, slog.New(slog.DiscardHandler))
	// Set before the listener starts, so nothing reads it concurrently.
	svc.keepalive = 30 * time.Millisecond
	srv := httptest.NewServer(svc.Handler())
	defer srv.Close()

	req, err := http.NewRequestWithContext(t.Context(), http.MethodGet, srv.URL+EventsPath, nil)
	if err != nil {
		t.Fatalf("NewRequestWithContext() = %v, want nil error", err)
	}
	req.Header.Set("Authorization", "Bearer good")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("stream request = %v, want nil error", err)
	}
	defer func() { _ = resp.Body.Close() }()

	reader := bufio.NewReader(resp.Body)
	line := readDataLine(t, reader)
	if !strings.Contains(line, `"kind":"ping"`) {
		t.Fatalf("first idle frame = %q, want a ping", line)
	}

	auth.revoked.Store(true)
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if _, err := reader.ReadString('\n'); err != nil {
			return
		}
	}
	t.Fatalf("the stream stayed open after the browser was revoked")
}

func readDataLine(t *testing.T, r *bufio.Reader) string {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		line, err := r.ReadString('\n')
		if err != nil {
			t.Fatalf("reading the stream = %v, want a data frame", err)
		}
		if strings.HasPrefix(line, "data: ") {
			return strings.TrimSpace(line)
		}
	}
	t.Fatalf("no data frame arrived on an idle stream")
	return ""
}
