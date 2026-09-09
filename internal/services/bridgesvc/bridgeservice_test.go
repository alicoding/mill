package bridgesvc_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/alicoding/mill/internal/domain/browserbridge"
	"github.com/alicoding/mill/internal/domain/usererror"
	"github.com/alicoding/mill/internal/services/bridgesvc"
	"github.com/alicoding/mill/internal/services/remoteauthsvc"
	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
)

// stubAuth stands in for remoteauthsvc so these tests pin the bridge's
// own behavior rather than re-testing the pairing store.
type stubAuth struct {
	token string
	// webhookToken is the webhook door's own credential -- a separate
	// field because the two kinds must never validate on each other's
	// routes.
	webhookToken string
	// Atomic: a test flips it while the stream's own goroutine may be
	// re-checking the token on its keepalive tick.
	revoked atomic.Bool
	pairErr error

	// The nearby-flow seam (goal 0379): a test sets these to control
	// what RequestPairing/PairingStatus answer, and reads the *Calls
	// slices back to pin what the HTTP layer forwarded.
	pairRequestInfo  remoteauthsvc.PairingRequestInfo
	pairRequestErr   error
	pairRequestCalls []string // one "label|source" entry per call
	pairStatus       remoteauthsvc.PairingRequestStatus
	pairStatusCalls  []string // one requestID per call

	// revokeCalls pins the self-revoke door (goal 0379 S2): the exact
	// device id RevokeDevice was called with, one entry per call --
	// what proves the HTTP layer forwards the TOKEN-resolved id, never
	// anything a request body could name.
	revokeCalls []string
	revokeErr   error
}

func (a *stubAuth) RevokeDevice(id string) error {
	a.revokeCalls = append(a.revokeCalls, id)
	if a.revokeErr != nil {
		return a.revokeErr
	}
	a.revoked.Store(true)
	return nil
}

func (a *stubAuth) PairBrowser(code, label, source, origin string) (remoteauthsvc.BrowserPairing, error) {
	if a.pairErr != nil {
		return remoteauthsvc.BrowserPairing{}, a.pairErr
	}
	return remoteauthsvc.BrowserPairing{Token: a.token, DeviceID: "browser-1", Label: label}, nil
}

func (a *stubAuth) RequestPairing(label, source, origin string) (remoteauthsvc.PairingRequestInfo, error) {
	a.pairRequestCalls = append(a.pairRequestCalls, label+"|"+source)
	if a.pairRequestErr != nil {
		return remoteauthsvc.PairingRequestInfo{}, a.pairRequestErr
	}
	return a.pairRequestInfo, nil
}

func (a *stubAuth) PairingStatus(requestID string) remoteauthsvc.PairingRequestStatus {
	a.pairStatusCalls = append(a.pairStatusCalls, requestID)
	return a.pairStatus
}

// BrowserOrigin/RecordBrowserOrigin are no-ops here: every test in this
// package that opens a socket dials with Go's own http client, which
// sends no Origin header, so coder/websocket's own check never fires
// regardless of what these return. The real binding (accept/mismatch/
// legacy-learn) is pinned directly against remoteauthsvc.RemoteAuthService
// in bridgeservice_origin_test.go, the one place it can be observed.
func (a *stubAuth) BrowserOrigin(deviceID string) (string, bool) { return "", false }

func (a *stubAuth) RecordBrowserOrigin(deviceID, origin string) {}

func (a *stubAuth) ValidateBrowserToken(token string) (remoteauthsvc.DeviceInfo, bool) {
	if a.revoked.Load() || token == "" || token != a.token {
		return remoteauthsvc.DeviceInfo{}, false
	}
	return remoteauthsvc.DeviceInfo{ID: "browser-1", Label: "Chrome", Kind: remoteauthsvc.KindBrowser}, true
}

func (a *stubAuth) ValidateWebhookToken(token string) (remoteauthsvc.DeviceInfo, bool) {
	if a.revoked.Load() || token == "" || token != a.webhookToken {
		return remoteauthsvc.DeviceInfo{}, false
	}
	return remoteauthsvc.DeviceInfo{ID: "webhook-1", Label: "CI", Kind: remoteauthsvc.KindWebhookToken}, true
}

func newService(t *testing.T, auth *stubAuth) (*bridgesvc.BridgeService, *httptest.Server) {
	t.Helper()
	svc := bridgesvc.New(auth, slog.New(slog.DiscardHandler))
	srv := httptest.NewServer(svc.Handler())
	t.Cleanup(srv.Close)
	return svc, srv
}

// openSocket connects as a paired browser over the WebSocket channel
// and returns the connection, plus a stop func. Fails the test if the
// handshake is refused. Every test in this package pairs against
// stubAuth{token: "good"}, so the subprotocol token is fixed here too.
func openSocket(t *testing.T, srv *httptest.Server) (*websocket.Conn, func()) {
	t.Helper()
	conn, resp, err := websocket.Dial(t.Context(), srv.URL+bridgesvc.WSPath, &websocket.DialOptions{
		Subprotocols: []string{"mill-token.good"},
	})
	// coder/websocket sets resp.Body nil on a successful upgrade (the
	// connection owns framing from then on) and to a NopCloser wrapping
	// what it already read on a refused one -- nil-safe either way.
	if resp != nil && resp.Body != nil {
		defer func() { _ = resp.Body.Close() }()
	}
	if err != nil {
		t.Fatalf("dialing the socket = %v, want nil error", err)
	}
	if resp.StatusCode != http.StatusSwitchingProtocols {
		t.Fatalf("socket status = %d, want %d", resp.StatusCode, http.StatusSwitchingProtocols)
	}
	return conn, func() { _ = conn.Close(websocket.StatusNormalClosure, "") }
}

// readCommand reads the next message off the socket as a command
// envelope.
func readCommand(t *testing.T, conn *websocket.Conn) browserbridge.Command {
	t.Helper()
	ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
	defer cancel()
	var command browserbridge.Command
	if err := wsjson.Read(ctx, conn, &command); err != nil {
		t.Fatalf("reading the socket = %v, want a command", err)
	}
	return command
}

func postResult(t *testing.T, srv *httptest.Server, token string, result browserbridge.Result) int {
	t.Helper()
	body, err := json.Marshal(result)
	if err != nil {
		t.Fatalf("marshalling the result = %v, want nil error", err)
	}
	req, err := http.NewRequestWithContext(t.Context(), http.MethodPost, srv.URL+bridgesvc.ResultPath, bytes.NewReader(body))
	if err != nil {
		t.Fatalf("NewRequestWithContext() = %v, want nil error", err)
	}
	req.Header.Set("Authorization", "Bearer "+token)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("result request = %v, want nil error", err)
	}
	defer func() { _ = resp.Body.Close() }()
	_, _ = io.Copy(io.Discard, resp.Body)
	return resp.StatusCode
}

// TestWS_RequiresPairedToken pins the rule that separates this listener
// from every other loopback surface in Mill: a loopback connection is
// NOT sufficient here, because any local process could otherwise drive
// the user's tabs. A plain (non-upgrade) request is enough to prove
// this: the token is checked and refused BEFORE websocket.Accept ever
// runs, so no real handshake is needed to see the 401.
func TestWS_RequiresPairedToken(t *testing.T) {
	_, srv := newService(t, &stubAuth{token: "good"})

	for _, tc := range []struct{ name, subprotocol string }{
		{"no subprotocol", ""},
		{"wrong token", "mill-token.wrong"},
		{"not the mill-token shape", "good"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			req, err := http.NewRequestWithContext(t.Context(), http.MethodGet, srv.URL+bridgesvc.WSPath, nil)
			if err != nil {
				t.Fatalf("NewRequestWithContext() = %v, want nil error", err)
			}
			if tc.subprotocol != "" {
				req.Header.Set("Sec-WebSocket-Protocol", tc.subprotocol)
			}
			resp, err := http.DefaultClient.Do(req)
			if err != nil {
				t.Fatalf("request = %v, want nil error", err)
			}
			defer func() { _ = resp.Body.Close() }()
			if resp.StatusCode != http.StatusUnauthorized {
				t.Fatalf("status = %d, want %d", resp.StatusCode, http.StatusUnauthorized)
			}
		})
	}
}

// TestReplay_NoBrowserConnected pins the named failure a reader can act
// on once beginRun's own wait for a browser to (re)connect (pinned by
// TestBeginRun_WaitsThenSucceeds/TestBeginRun_WaitsThenFails in
// bridgeservice_ws_test.go) has run out. The wait itself is shortened
// via ConnectWaitEnvVar -- an external test has no access to the
// unexported field a same-package test would set directly.
func TestReplay_NoBrowserConnected(t *testing.T) {
	t.Setenv(bridgesvc.ConnectWaitEnvVar, "50")
	svc, _ := newService(t, &stubAuth{token: "good"})

	_, err := svc.Replay(context.Background(), browserbridge.TestFlow("http://127.0.0.1:1/page"), bridgesvc.ReplayOptions{})
	if err == nil {
		t.Fatalf("Replay() with nothing connected = nil error, want a failure")
	}
	var declared *usererror.Error
	if !errors.As(err, &declared) || declared.Code != browserbridge.CodeNoBrowser {
		t.Fatalf("Replay() error = %v, want code %q", err, browserbridge.CodeNoBrowser)
	}
	if declared.Message != "No browser is connected. Open the Mill extension in your browser and run again." {
		t.Fatalf("Replay() message = %q, want the open-extension sentence", declared.Message)
	}
}

// TestReplay_DeliversAndCorrelates walks the whole round trip: the
// command reaches the open stream, per-step results file against the
// run's id, and the final result closes it with the step count.
func TestReplay_DeliversAndCorrelates(t *testing.T) {
	auth := &stubAuth{token: "good"}
	svc, srv := newService(t, auth)
	conn, stop := openSocket(t, srv)
	defer stop()
	waitForBrowsers(t, svc)

	type outcome struct {
		out bridgesvc.Outcome
		err error
	}
	results := make(chan outcome, 1)
	go func() {
		out, err := svc.Replay(context.Background(), browserbridge.TestFlow(srv.URL+bridgesvc.TestPagePath), bridgesvc.ReplayOptions{})
		results <- outcome{out, err}
	}()

	command := readCommand(t, conn)
	if command.Kind != browserbridge.KindReplay {
		t.Fatalf("command kind = %q, want %q", command.Kind, browserbridge.KindReplay)
	}
	if command.ID == "" {
		t.Fatalf("command carries no run id, so no result could correlate")
	}
	if command.Flow == nil || len(command.Flow.Steps) != browserbridge.TestFlowSteps {
		t.Fatalf("command flow = %+v, want %d steps", command.Flow, browserbridge.TestFlowSteps)
	}

	for i := range command.Flow.Steps {
		idx := i
		if code := postResult(t, srv, "good", browserbridge.Result{ID: command.ID, StepIndex: &idx, Status: browserbridge.StatusOK}); code != http.StatusNoContent {
			t.Fatalf("step result status = %d, want %d", code, http.StatusNoContent)
		}
	}
	// A result carrying an id nothing is waiting on must be accepted and
	// dropped, never crash or leak a run.
	strayIdx := 0
	if code := postResult(t, srv, "good", browserbridge.Result{ID: "run-that-ended", StepIndex: &strayIdx, Status: browserbridge.StatusOK}); code != http.StatusNoContent {
		t.Fatalf("stray result status = %d, want %d", code, http.StatusNoContent)
	}
	if code := postResult(t, srv, "good", browserbridge.Result{ID: command.ID, Status: browserbridge.StatusDone}); code != http.StatusNoContent {
		t.Fatalf("final result status = %d, want %d", code, http.StatusNoContent)
	}

	select {
	case got := <-results:
		if got.err != nil {
			t.Fatalf("Replay() = %v, want nil error", got.err)
		}
		if got.out.Steps != browserbridge.TestFlowSteps {
			t.Fatalf("Replay() steps = %d, want %d", got.out.Steps, browserbridge.TestFlowSteps)
		}
	case <-time.After(10 * time.Second):
		t.Fatalf("Replay() never returned after the final result")
	}
}

// TestReplay_FailedRunCarriesTheBrowsersSentence pins that a failing
// step's reason reaches the caller as the user-facing sentence, not a
// generic one.
func TestReplay_FailedRunCarriesTheBrowsersSentence(t *testing.T) {
	svc, srv := newService(t, &stubAuth{token: "good"})
	conn, stop := openSocket(t, srv)
	defer stop()
	waitForBrowsers(t, svc)

	errs := make(chan error, 1)
	go func() {
		_, err := svc.Replay(context.Background(), browserbridge.TestFlow(srv.URL+bridgesvc.TestPagePath), bridgesvc.ReplayOptions{})
		errs <- err
	}()

	command := readCommand(t, conn)
	sentence := "Couldn't find the element for step 2 (#mill-bridge-button)."
	postResult(t, srv, "good", browserbridge.Result{ID: command.ID, Status: browserbridge.StatusFailed, Error: sentence})

	select {
	case err := <-errs:
		var declared *usererror.Error
		if !errors.As(err, &declared) || declared.Code != browserbridge.CodeReplayFailed {
			t.Fatalf("Replay() error = %v, want code %q", err, browserbridge.CodeReplayFailed)
		}
		if declared.Message != sentence {
			t.Fatalf("Replay() message = %q, want %q", declared.Message, sentence)
		}
	case <-time.After(10 * time.Second):
		t.Fatalf("Replay() never returned after a failed run")
	}
}

// TestResult_RequiresPairedToken pins that the intake is behind the
// same credential the stream is -- an unpaired caller must not be able
// to forge somebody's run results.
func TestResult_RequiresPairedToken(t *testing.T) {
	_, srv := newService(t, &stubAuth{token: "good"})
	idx := 0
	if code := postResult(t, srv, "wrong", browserbridge.Result{ID: "run-1", StepIndex: &idx, Status: browserbridge.StatusOK}); code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d", code, http.StatusUnauthorized)
	}
}

// TestKeepaliveEnvelope_CarriesNoRunID pins the keepalive's wire shape:
// it must never look like a command a browser could try to run, so it
// carries a kind and nothing else. The interval and the socket's own
// behaviour are pinned in-package by
// TestWS_KeepaliveMessagesAndClosesOnRevoke (bridgeservice_ws_test.go).
func TestKeepaliveEnvelope_CarriesNoRunID(t *testing.T) {
	if browserbridge.KeepaliveSeconds <= 0 {
		t.Fatalf("KeepaliveSeconds = %d, want a positive interval", browserbridge.KeepaliveSeconds)
	}
	encoded, err := json.Marshal(browserbridge.Command{Kind: browserbridge.KindKeepalive})
	if err != nil {
		t.Fatalf("marshalling a keepalive = %v, want nil error", err)
	}
	if got := string(encoded); got != `{"kind":"keepalive"}` {
		t.Fatalf("keepalive envelope = %s, want a bare kind with no run id", got)
	}
}

// TestResult_RevokedBrowserIsRefusedImmediately pins the half of
// revocation that takes effect with no wait: a revoked browser's very
// next result POST is refused. The socket's own drop is pinned by
// TestWS_KeepaliveMessagesAndClosesOnRevoke (bridgeservice_ws_test.go).
func TestResult_RevokedBrowserIsRefusedImmediately(t *testing.T) {
	auth := &stubAuth{token: "good"}
	svc, srv := newService(t, auth)
	_, stop := openSocket(t, srv)
	defer stop()
	waitForBrowsers(t, svc)

	auth.revoked.Store(true)
	idx := 0
	if code := postResult(t, srv, "good", browserbridge.Result{ID: "run-1", StepIndex: &idx, Status: browserbridge.StatusOK}); code != http.StatusUnauthorized {
		t.Fatalf("revoked result status = %d, want %d", code, http.StatusUnauthorized)
	}
}

// TestPair_LoopbackOnly pins that the code exchange refuses a
// non-loopback caller outright.
func TestPair_LoopbackOnly(t *testing.T) {
	auth := &stubAuth{token: "minted"}
	svc := bridgesvc.New(auth, slog.New(slog.DiscardHandler))
	handler := svc.Handler()

	req := httptest.NewRequestWithContext(t.Context(), http.MethodPost, bridgesvc.PairPath, strings.NewReader(`{"code":"ABCD2345","label":"Chrome"}`))
	req.RemoteAddr = "203.0.113.9:5555"
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("non-loopback pair status = %d, want %d", rec.Code, http.StatusNotFound)
	}

	req = httptest.NewRequestWithContext(t.Context(), http.MethodPost, bridgesvc.PairPath, strings.NewReader(`{"code":"ABCD2345","label":"Chrome"}`))
	req.RemoteAddr = "127.0.0.1:5555"
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("loopback pair status = %d, want %d", rec.Code, http.StatusOK)
	}
	var pairing remoteauthsvc.BrowserPairing
	if err := json.NewDecoder(rec.Body).Decode(&pairing); err != nil {
		t.Fatalf("decoding the pairing = %v, want nil error", err)
	}
	if pairing.Token != "minted" || pairing.Label != "Chrome" {
		t.Fatalf("pairing = %+v, want the minted token and the announced label", pairing)
	}
}

// TestPair_BadCodeCarriesItsSentence pins that a refused code reaches
// the extension as one actionable sentence, never an internal chain.
func TestPair_BadCodeCarriesItsSentence(t *testing.T) {
	auth := &stubAuth{pairErr: usererror.New(remoteauthsvc.CodeBadPairingCode, "That code didn't work. Generate a new one and try again.")}
	svc := bridgesvc.New(auth, slog.New(slog.DiscardHandler))

	req := httptest.NewRequestWithContext(t.Context(), http.MethodPost, bridgesvc.PairPath, strings.NewReader(`{"code":"NOPE"}`))
	req.RemoteAddr = "127.0.0.1:5555"
	rec := httptest.NewRecorder()
	svc.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("bad-code status = %d, want %d", rec.Code, http.StatusUnauthorized)
	}
	var body map[string]string
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("decoding the error = %v, want nil error", err)
	}
	if body["code"] != remoteauthsvc.CodeBadPairingCode {
		t.Fatalf("error code = %q, want %q", body["code"], remoteauthsvc.CodeBadPairingCode)
	}
	if !strings.HasPrefix(body["error"], "That code didn't work.") {
		t.Fatalf("error sentence = %q, want the try-again sentence", body["error"])
	}
}

// TestTestPage_ServesTheFlowsElements pins that the page and the
// built-in flow cannot drift: every id the flow selects on is present.
func TestTestPage_ServesTheFlowsElements(t *testing.T) {
	_, srv := newService(t, &stubAuth{token: "good"})
	req, err := http.NewRequestWithContext(t.Context(), http.MethodGet, srv.URL+bridgesvc.TestPagePath, nil)
	if err != nil {
		t.Fatalf("NewRequestWithContext() = %v, want nil error", err)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("test page request = %v, want nil error", err)
	}
	defer func() { _ = resp.Body.Close() }()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("reading the test page = %v, want nil error", err)
	}
	for _, id := range []string{browserbridge.TestPageButtonID, browserbridge.TestPageReadyID} {
		if !strings.Contains(string(body), fmt.Sprintf("id=%q", id)) {
			t.Fatalf("test page has no element with id %q, so the built-in flow cannot resolve it", id)
		}
	}
}

// TestBridgeStatus_ReportsAddressAndConnections pins the Settings read
// model: an address a browser can be pointed at, and whether one is
// listening right now.
func TestBridgeStatus_ReportsAddressAndConnections(t *testing.T) {
	auth := &stubAuth{token: "good"}
	svc, srv := newService(t, auth)

	before := svc.BridgeStatus()
	if before.Connected || before.Browsers != 0 {
		t.Fatalf("status before connecting = %+v, want no browsers", before)
	}
	if !strings.HasPrefix(before.Address, "http://") {
		t.Fatalf("status address = %q, want an http address", before.Address)
	}

	_, stop := openSocket(t, srv)
	defer stop()
	waitForBrowsers(t, svc)
	if after := svc.BridgeStatus(); !after.Connected || after.Browsers != 1 {
		t.Fatalf("status while connected = %+v, want one connected browser", after)
	}
}

// TestResolveAddr pins the precedence the Settings caption describes.
func TestResolveAddr(t *testing.T) {
	if addr, override := bridgesvc.ResolveAddr(""); addr != bridgesvc.AddrDefault || override {
		t.Fatalf("ResolveAddr(\"\") = %q/%v, want %q/false", addr, override, bridgesvc.AddrDefault)
	}
	if addr, override := bridgesvc.ResolveAddr("127.0.0.1:9999"); addr != "127.0.0.1:9999" || !override {
		t.Fatalf("ResolveAddr(env) = %q/%v, want the env value and true", addr, override)
	}
}

// waitForBrowsers blocks until the service has registered n connected
// browsers -- the stream handshake completes on the server after the
// client's response headers arrive, so a bare assert would race it.
func waitForBrowsers(t *testing.T, svc *bridgesvc.BridgeService) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if svc.BridgeStatus().Browsers == 1 {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("waited for the connected browser, got %d", svc.BridgeStatus().Browsers)
}
