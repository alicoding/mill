package bridgesvc_test

import (
	"bufio"
	"bytes"
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
)

// stubAuth stands in for remoteauthsvc so these tests pin the bridge's
// own behavior rather than re-testing the pairing store.
type stubAuth struct {
	token string
	// Atomic: a test flips it while the stream's own goroutine may be
	// re-checking the token on its keepalive tick.
	revoked atomic.Bool
	pairErr error
}

func (a *stubAuth) PairBrowser(code, label, source string) (remoteauthsvc.BrowserPairing, error) {
	if a.pairErr != nil {
		return remoteauthsvc.BrowserPairing{}, a.pairErr
	}
	return remoteauthsvc.BrowserPairing{Token: a.token, DeviceID: "browser-1", Label: label}, nil
}

func (a *stubAuth) ValidateBrowserToken(token string) (remoteauthsvc.DeviceInfo, bool) {
	if a.revoked.Load() || token == "" || token != a.token {
		return remoteauthsvc.DeviceInfo{}, false
	}
	return remoteauthsvc.DeviceInfo{ID: "browser-1", Label: "Chrome", Kind: remoteauthsvc.KindBrowser}, true
}

func newService(t *testing.T, auth *stubAuth) (*bridgesvc.BridgeService, *httptest.Server) {
	t.Helper()
	svc := bridgesvc.New(auth, slog.New(slog.DiscardHandler))
	srv := httptest.NewServer(svc.Handler())
	t.Cleanup(srv.Close)
	return svc, srv
}

// openStream connects as a paired browser and returns a reader over the
// SSE frames, plus a stop func. Fails the test if the handshake is
// refused.
func openStream(t *testing.T, srv *httptest.Server) (*bufio.Reader, func()) {
	t.Helper()
	req, err := http.NewRequestWithContext(t.Context(), http.MethodGet, srv.URL+bridgesvc.EventsPath, nil)
	if err != nil {
		t.Fatalf("NewRequestWithContext() = %v, want nil error", err)
	}
	req.Header.Set("Authorization", "Bearer good")
	resp, err := http.DefaultClient.Do(req) //nolint:bodyclose // closed by the returned stop func
	if err != nil {
		t.Fatalf("stream request = %v, want nil error", err)
	}
	if resp.StatusCode != http.StatusOK {
		_ = resp.Body.Close()
		t.Fatalf("stream status = %d, want %d", resp.StatusCode, http.StatusOK)
	}
	return bufio.NewReader(resp.Body), func() { _ = resp.Body.Close() }
}

// readCommand reads the next SSE data frame as a command envelope.
func readCommand(t *testing.T, r *bufio.Reader) browserbridge.Command {
	t.Helper()
	for {
		line, err := r.ReadString('\n')
		if err != nil {
			t.Fatalf("reading the stream = %v, want a data frame", err)
		}
		line = strings.TrimSpace(line)
		if !strings.HasPrefix(line, "data: ") {
			continue
		}
		var command browserbridge.Command
		if err := json.Unmarshal([]byte(strings.TrimPrefix(line, "data: ")), &command); err != nil {
			t.Fatalf("decoding %q = %v, want a command", line, err)
		}
		return command
	}
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

// TestEvents_RequiresPairedToken pins the rule that separates this
// listener from every other loopback surface in Mill: a loopback
// connection is NOT sufficient here, because any local process could
// otherwise drive the user's tabs.
func TestEvents_RequiresPairedToken(t *testing.T) {
	_, srv := newService(t, &stubAuth{token: "good"})

	for _, tc := range []struct{ name, header string }{
		{"no header", ""},
		{"wrong token", "Bearer wrong"},
		{"not a bearer", "good"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			req, err := http.NewRequestWithContext(t.Context(), http.MethodGet, srv.URL+bridgesvc.EventsPath, nil)
			if err != nil {
				t.Fatalf("NewRequestWithContext() = %v, want nil error", err)
			}
			if tc.header != "" {
				req.Header.Set("Authorization", tc.header)
			}
			resp, err := http.DefaultClient.Do(req)
			if err != nil {
				t.Fatalf("stream request = %v, want nil error", err)
			}
			defer func() { _ = resp.Body.Close() }()
			if resp.StatusCode != http.StatusUnauthorized {
				t.Fatalf("status = %d, want %d", resp.StatusCode, http.StatusUnauthorized)
			}
		})
	}
}

// TestReplay_NoBrowserConnected pins the immediate, named failure --
// never a wait that ends in a timeout the reader can't act on.
func TestReplay_NoBrowserConnected(t *testing.T) {
	svc, _ := newService(t, &stubAuth{token: "good"})

	_, err := svc.Replay(browserbridge.TestFlow("http://127.0.0.1:1/page"), nil)
	if err == nil {
		t.Fatalf("Replay() with nothing connected = nil error, want a failure")
	}
	var declared *usererror.Error
	if !errors.As(err, &declared) || declared.Code != browserbridge.CodeNoBrowser {
		t.Fatalf("Replay() error = %v, want code %q", err, browserbridge.CodeNoBrowser)
	}
	if declared.Message != "No browser is connected. Pair the Mill extension first." {
		t.Fatalf("Replay() message = %q, want the pair-first sentence", declared.Message)
	}
}

// TestReplay_DeliversAndCorrelates walks the whole round trip: the
// command reaches the open stream, per-step results file against the
// run's id, and the final result closes it with the step count.
func TestReplay_DeliversAndCorrelates(t *testing.T) {
	auth := &stubAuth{token: "good"}
	svc, srv := newService(t, auth)
	stream, stop := openStream(t, srv)
	defer stop()
	waitForBrowsers(t, svc)

	type outcome struct {
		out bridgesvc.Outcome
		err error
	}
	results := make(chan outcome, 1)
	go func() {
		out, err := svc.Replay(browserbridge.TestFlow(srv.URL+bridgesvc.TestPagePath), nil)
		results <- outcome{out, err}
	}()

	command := readCommand(t, stream)
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
	stream, stop := openStream(t, srv)
	defer stop()
	waitForBrowsers(t, svc)

	errs := make(chan error, 1)
	go func() {
		_, err := svc.Replay(browserbridge.TestFlow(srv.URL+bridgesvc.TestPagePath), nil)
		errs <- err
	}()

	command := readCommand(t, stream)
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

// TestPingEnvelope_CarriesNoRunID pins the ping's wire shape: a
// keepalive must never look like a command a browser could try to run,
// so it carries a kind and nothing else. The interval and the stream's
// own behaviour are pinned in-package by
// TestEvents_KeepalivePingsAndClosesOnRevoke.
func TestPingEnvelope_CarriesNoRunID(t *testing.T) {
	if browserbridge.KeepaliveSeconds <= 0 {
		t.Fatalf("KeepaliveSeconds = %d, want a positive interval", browserbridge.KeepaliveSeconds)
	}
	encoded, err := json.Marshal(browserbridge.Command{Kind: browserbridge.KindPing})
	if err != nil {
		t.Fatalf("marshalling a ping = %v, want nil error", err)
	}
	if got := string(encoded); got != `{"kind":"ping"}` {
		t.Fatalf("ping envelope = %s, want a bare kind with no run id", got)
	}
}

// TestResult_RevokedBrowserIsRefusedImmediately pins the half of
// revocation that takes effect with no wait: a revoked browser's very
// next result POST is refused. The stream's own drop is pinned by
// TestEvents_RevokedStreamClosesOnKeepalive.
func TestResult_RevokedBrowserIsRefusedImmediately(t *testing.T) {
	auth := &stubAuth{token: "good"}
	svc, srv := newService(t, auth)
	_, stop := openStream(t, srv)
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

	_, stop := openStream(t, srv)
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
