package bridgesvc

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/alicoding/mill/internal/domain/browserbridge"
	"github.com/alicoding/mill/internal/domain/usererror"
	"github.com/alicoding/mill/internal/services/remoteauthsvc"
	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
)

// In-package so keepalive/connectWait can be shortened before the
// listener starts and beginRun's own unexported return values can be
// read directly -- goal 0418's WebSocket channel and connect-wait,
// split from bridgeservice_test.go along the same seam
// (bridgeservice_replay_test.go's own doc comment).

// revocableAuth flips from paired to revoked mid-socket. The flag is
// atomic because a test sets it while the socket's own goroutine may be
// re-checking the token on its keepalive tick.
type revocableAuth struct{ revoked atomic.Bool }

func (a *revocableAuth) PairBrowser(code, label, source, origin string) (remoteauthsvc.BrowserPairing, error) {
	return remoteauthsvc.BrowserPairing{}, nil
}

func (a *revocableAuth) ValidateBrowserToken(token string) (remoteauthsvc.DeviceInfo, bool) {
	if a.revoked.Load() || token != "good" {
		return remoteauthsvc.DeviceInfo{}, false
	}
	return remoteauthsvc.DeviceInfo{ID: "browser-1", Label: "Chrome", Kind: remoteauthsvc.KindBrowser}, true
}

func (a *revocableAuth) ValidateWebhookToken(token string) (remoteauthsvc.DeviceInfo, bool) {
	return remoteauthsvc.DeviceInfo{}, false
}

func (a *revocableAuth) RequestPairing(label, source, origin string) (remoteauthsvc.PairingRequestInfo, error) {
	return remoteauthsvc.PairingRequestInfo{}, nil
}

func (a *revocableAuth) PairingStatus(requestID string) remoteauthsvc.PairingRequestStatus {
	return remoteauthsvc.PairingRequestStatus{Status: "expired"}
}

// BrowserOrigin/RecordBrowserOrigin are no-ops here: every WS test in
// this file dials with Go's own http client, which sends no Origin
// header at all -- coder/websocket's own check is a no-op for a
// request that carries none, so this stub never needs one recorded.
func (a *revocableAuth) BrowserOrigin(deviceID string) (string, bool) { return "", false }

func (a *revocableAuth) RecordBrowserOrigin(deviceID, origin string) {}

func (a *revocableAuth) RevokeDevice(id string) error {
	a.revoked.Store(true)
	return nil
}

// TestWS_AcceptsSubprotocolTokenAndDeliversCommands pins the handshake
// this channel replaced SSE with: the bearer token rides the
// Sec-WebSocket-Protocol value, is negotiated back on Conn.Subprotocol,
// and a command Replay hands the client reaches the socket as one JSON
// message.
func TestWS_AcceptsSubprotocolTokenAndDeliversCommands(t *testing.T) {
	auth := &revocableAuth{}
	svc := New(auth, slog.New(slog.DiscardHandler))
	srv := httptest.NewServer(svc.Handler())
	defer srv.Close()

	conn, resp, err := websocket.Dial(t.Context(), srv.URL+WSPath, &websocket.DialOptions{
		Subprotocols: []string{"mill-token.good"},
	})
	defer closeRespBody(resp)
	if err != nil {
		t.Fatalf("Dial() = %v, want nil error", err)
	}
	defer func() { _ = conn.Close(websocket.StatusNormalClosure, "") }()
	if resp.StatusCode != http.StatusSwitchingProtocols {
		t.Fatalf("status = %d, want %d", resp.StatusCode, http.StatusSwitchingProtocols)
	}
	if got := conn.Subprotocol(); got != "mill-token.good" {
		t.Fatalf("negotiated subprotocol = %q, want the token carried back", got)
	}

	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) && svc.BridgeStatus().Browsers != 1 {
		time.Sleep(10 * time.Millisecond)
	}
	if svc.BridgeStatus().Browsers != 1 {
		t.Fatal("the socket never registered as a connected browser")
	}

	id, _, c, _, err := svc.beginRun(t.Context())
	if err != nil {
		t.Fatalf("beginRun() = %v, want nil error with a browser attached", err)
	}
	defer svc.endRun(id)
	c.commands <- browserbridge.Command{ID: id, Kind: browserbridge.KindReplay}

	ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
	defer cancel()
	var got browserbridge.Command
	if err := wsjson.Read(ctx, conn, &got); err != nil {
		t.Fatalf("reading the socket = %v, want the command", err)
	}
	if got.ID != id || got.Kind != browserbridge.KindReplay {
		t.Fatalf("received = %+v, want the command Replay sent", got)
	}
}

// TestWS_RequiresPairedToken_BadToken is the in-package half of
// bridgeservice_test.go's own TestWS_RequiresPairedToken -- a bad
// subprotocol token is refused with 401 before websocket.Accept runs at
// all, so the negative case needs no real WebSocket handshake either.
func TestWS_RequiresPairedToken_BadToken(t *testing.T) {
	svc := New(&revocableAuth{}, slog.New(slog.DiscardHandler))
	srv := httptest.NewServer(svc.Handler())
	defer srv.Close()

	req, err := http.NewRequestWithContext(t.Context(), http.MethodGet, srv.URL+WSPath, nil)
	if err != nil {
		t.Fatalf("NewRequestWithContext() = %v, want nil error", err)
	}
	req.Header.Set("Sec-WebSocket-Protocol", "mill-token.wrong")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("request = %v, want nil error", err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d", resp.StatusCode, http.StatusUnauthorized)
	}
}

// TestWS_KeepaliveMessagesAndClosesOnRevoke pins both jobs the
// keepalive does: an idle socket keeps receiving keepalive messages
// (what keeps a browser extension's service worker alive between
// commands, per Chrome 116+'s own WebSocket-activity lifetime
// extender), and a browser revoked in Settings loses its live socket on
// that same tick rather than surviving until it next reconnects.
func TestWS_KeepaliveMessagesAndClosesOnRevoke(t *testing.T) {
	auth := &revocableAuth{}
	svc := New(auth, slog.New(slog.DiscardHandler))
	// Set before the listener starts, so nothing reads it concurrently.
	svc.keepalive = 30 * time.Millisecond
	srv := httptest.NewServer(svc.Handler())
	defer srv.Close()

	conn, resp, err := websocket.Dial(t.Context(), srv.URL+WSPath, &websocket.DialOptions{
		Subprotocols: []string{"mill-token.good"},
	})
	closeRespBody(resp)
	if err != nil {
		t.Fatalf("Dial() = %v, want nil error", err)
	}
	defer func() { _ = conn.Close(websocket.StatusNormalClosure, "") }()

	ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
	defer cancel()
	var first browserbridge.Command
	if err := wsjson.Read(ctx, conn, &first); err != nil {
		t.Fatalf("reading the first idle message = %v, want a keepalive", err)
	}
	if first.Kind != browserbridge.KindKeepalive {
		t.Fatalf("first idle message kind = %q, want %q", first.Kind, browserbridge.KindKeepalive)
	}

	auth.revoked.Store(true)
	readCtx, readCancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer readCancel()
	var next browserbridge.Command
	if err := wsjson.Read(readCtx, conn, &next); err == nil {
		t.Fatalf("read after revoke = %+v, nil error, want the socket to close", next)
	}
}

// TestBeginRun_WaitsThenSucceeds pins beginRun's own wait: a client
// attaching partway through the window lets a pending run proceed
// rather than failing immediately.
func TestBeginRun_WaitsThenSucceeds(t *testing.T) {
	svc := New(&revocableAuth{}, slog.New(slog.DiscardHandler))
	svc.connectWait = 2 * time.Second
	srv := httptest.NewServer(svc.Handler())
	defer srv.Close()

	connected := make(chan *websocket.Conn, 1)
	go func() {
		time.Sleep(100 * time.Millisecond)
		conn, resp, err := websocket.Dial(context.Background(), srv.URL+WSPath, &websocket.DialOptions{
			Subprotocols: []string{"mill-token.good"},
		})
		closeRespBody(resp)
		if err == nil {
			connected <- conn
		}
	}()
	defer func() {
		select {
		case conn := <-connected:
			_ = conn.Close(websocket.StatusNormalClosure, "")
		default:
		}
	}()

	started := time.Now()
	id, _, c, waitedMS, err := svc.beginRun(t.Context())
	elapsed := time.Since(started)
	if err != nil {
		t.Fatalf("beginRun() = %v, want nil error once a browser attaches", err)
	}
	defer svc.endRun(id)
	if c == nil {
		t.Fatal("beginRun() returned a nil client")
	}
	if elapsed < 90*time.Millisecond {
		t.Fatalf("beginRun() returned after %v, want it to have actually waited for the connect above", elapsed)
	}
	if waitedMS <= 0 {
		t.Fatalf("waitedMS = %d, want a positive wait recorded", waitedMS)
	}
}

// TestBeginRun_WaitsThenFails pins the honest failure once connectWait
// elapses with nobody ever connecting -- the same named error a caller
// gets immediately when NOTHING waits at all.
func TestBeginRun_WaitsThenFails(t *testing.T) {
	svc := New(&revocableAuth{}, slog.New(slog.DiscardHandler))
	svc.connectWait = 200 * time.Millisecond
	srv := httptest.NewServer(svc.Handler())
	defer srv.Close()

	started := time.Now()
	_, _, _, waitedMS, err := svc.beginRun(t.Context())
	elapsed := time.Since(started)
	if err == nil {
		t.Fatal("beginRun() with nothing ever connecting = nil error, want ErrNoBrowser")
	}
	var declared *usererror.Error
	if !errors.As(err, &declared) || declared.Code != browserbridge.CodeNoBrowser {
		t.Fatalf("beginRun() error = %v, want code %q", err, browserbridge.CodeNoBrowser)
	}
	if elapsed < 200*time.Millisecond {
		t.Fatalf("beginRun() returned after %v, want it to have waited out the full deadline", elapsed)
	}
	if waitedMS < 200 {
		t.Fatalf("waitedMS = %d, want at least the deadline it waited out", waitedMS)
	}
}
