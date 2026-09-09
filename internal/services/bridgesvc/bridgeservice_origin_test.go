package bridgesvc

import (
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/alicoding/mill/internal/services/remoteauthsvc"
	"github.com/coder/websocket"
)

// The WebSocket door's own Origin binding (goal 0418): a credential
// accepts a socket only from the Origin recorded on it, and a
// credential paired before this existed learns its origin from its
// first connection and enforces it from then on. In-package because
// the fake TokenAuthority below needs to track real per-credential
// origin state -- unlike revocableAuth/stubAuth elsewhere in this
// package, whose own WS tests dial with Go's http client and never
// need one (it sends no Origin header at all, and coder/websocket's
// own check is a no-op for a request that carries none).

// originAuth is a minimal TokenAuthority double that tracks ONE
// browser credential's own recorded Origin, mirroring
// remoteauthsvc.RemoteAuthService's real BrowserOrigin/
// RecordBrowserOrigin contract closely enough to pin handleWS's own
// behavior against it.
type originAuth struct {
	origin string // "" until RecordBrowserOrigin sets one
}

func (a *originAuth) PairBrowser(code, label, source, origin string) (remoteauthsvc.BrowserPairing, error) {
	return remoteauthsvc.BrowserPairing{}, nil
}

func (a *originAuth) ValidateBrowserToken(token string) (remoteauthsvc.DeviceInfo, bool) {
	if token != "good" {
		return remoteauthsvc.DeviceInfo{}, false
	}
	return remoteauthsvc.DeviceInfo{ID: "browser-1", Label: "Chrome", Kind: remoteauthsvc.KindBrowser}, true
}

func (a *originAuth) ValidateWebhookToken(token string) (remoteauthsvc.DeviceInfo, bool) {
	return remoteauthsvc.DeviceInfo{}, false
}

func (a *originAuth) RequestPairing(label, source, origin string) (remoteauthsvc.PairingRequestInfo, error) {
	return remoteauthsvc.PairingRequestInfo{}, nil
}

func (a *originAuth) PairingStatus(requestID string) remoteauthsvc.PairingRequestStatus {
	return remoteauthsvc.PairingRequestStatus{Status: "expired"}
}

func (a *originAuth) RevokeDevice(id string) error { return nil }

func (a *originAuth) BrowserOrigin(deviceID string) (string, bool) {
	return a.origin, a.origin != ""
}

func (a *originAuth) RecordBrowserOrigin(deviceID, origin string) {
	if a.origin == "" {
		a.origin = origin
	}
}

func dialWithOrigin(t *testing.T, srv *httptest.Server, origin string) (*websocket.Conn, *http.Response, error) {
	t.Helper()
	opts := &websocket.DialOptions{Subprotocols: []string{"mill-token.good"}}
	if origin != "" {
		opts.HTTPHeader = http.Header{"Origin": []string{origin}}
	}
	return websocket.Dial(t.Context(), srv.URL+WSPath, opts)
}

// closeRespBody closes the handshake response Dial hands back,
// regardless of outcome: coder/websocket sets resp.Body nil on a
// successful upgrade (the connection owns framing from then on) and to
// a NopCloser wrapping what it already read on a refused one -- nil-
// safe here so every dialWithOrigin call site can defer it uniformly.
func closeRespBody(resp *http.Response) {
	if resp != nil && resp.Body != nil {
		_ = resp.Body.Close()
	}
}

// TestWS_AcceptsMatchingOrigin pins the happy path: a socket whose
// Origin header matches the credential's own recorded one is accepted.
func TestWS_AcceptsMatchingOrigin(t *testing.T) {
	auth := &originAuth{origin: "chrome-extension://good1234"}
	svc := New(auth, slog.New(slog.DiscardHandler))
	srv := httptest.NewServer(svc.Handler())
	defer srv.Close()

	conn, resp, err := dialWithOrigin(t, srv, "chrome-extension://good1234")
	if err != nil {
		t.Fatalf("Dial() with the matching origin = %v, want nil error", err)
	}
	defer closeRespBody(resp)
	defer func() { _ = conn.Close(websocket.StatusNormalClosure, "") }()
	if resp.StatusCode != http.StatusSwitchingProtocols {
		t.Fatalf("status = %d, want %d", resp.StatusCode, http.StatusSwitchingProtocols)
	}
}

// TestWS_RejectsMismatchedOriginWith403 pins that a valid token cannot
// carry a socket across from a different origin than the one recorded
// on its credential -- coder/websocket's own Accept refuses it, this
// handler decides nothing about the status code itself.
func TestWS_RejectsMismatchedOriginWith403(t *testing.T) {
	auth := &originAuth{origin: "chrome-extension://good1234"}
	svc := New(auth, slog.New(slog.DiscardHandler))
	srv := httptest.NewServer(svc.Handler())
	defer srv.Close()

	_, resp, err := dialWithOrigin(t, srv, "chrome-extension://evil9999")
	defer closeRespBody(resp)
	if err == nil {
		t.Fatal("Dial() with a mismatched origin = nil error, want the handshake refused")
	}
	if resp == nil || resp.StatusCode != http.StatusForbidden {
		status := -1
		if resp != nil {
			status = resp.StatusCode
		}
		t.Fatalf("status = %d, want %d", status, http.StatusForbidden)
	}
}

// TestWS_LegacyCredentialLearnsOriginOnFirstConnect pins the migration
// path: a credential with no recorded origin (paired before goal 0418)
// accepts its very first connection from whatever origin it presents,
// learns it, and enforces it against every connection after.
func TestWS_LegacyCredentialLearnsOriginOnFirstConnect(t *testing.T) {
	auth := &originAuth{}
	svc := New(auth, slog.New(slog.DiscardHandler))
	srv := httptest.NewServer(svc.Handler())
	defer srv.Close()

	conn, firstResp, err := dialWithOrigin(t, srv, "chrome-extension://first-seen")
	closeRespBody(firstResp)
	if err != nil {
		t.Fatalf("first Dial() = %v, want nil error (nothing recorded yet)", err)
	}
	_ = conn.Close(websocket.StatusNormalClosure, "")

	if got, ok := auth.BrowserOrigin("browser-1"); !ok || got != "chrome-extension://first-seen" {
		t.Fatalf("BrowserOrigin() = (%q, %v), want the origin learned on first connect", got, ok)
	}

	_, secondResp, err := dialWithOrigin(t, srv, "chrome-extension://someone-else")
	defer closeRespBody(secondResp)
	if err == nil {
		t.Fatal("second Dial() with a different origin = nil error, want it refused now that one is learned")
	}
	if secondResp == nil || secondResp.StatusCode != http.StatusForbidden {
		status := -1
		if secondResp != nil {
			status = secondResp.StatusCode
		}
		t.Fatalf("status = %d, want %d", status, http.StatusForbidden)
	}
}
