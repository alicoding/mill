package bridgesvc

import (
	"context"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/alicoding/mill/internal/domain/audit"
	"github.com/alicoding/mill/internal/domain/browserbridge"
	"github.com/alicoding/mill/internal/domain/usererror"
	"github.com/alicoding/mill/internal/services/remoteauthsvc"
)

// The bridge's four browser routes. Everything lives under one prefix
// so a future mount alongside other handlers can never collide with an
// app route. The hook door's own route constant lives with its handler
// in bridgeservice_hooks.go. RootPath is the exception: it is the
// listener's own address, answered for a human who pastes it into a
// browser rather than a tool that reads it (goal 0369).
const (
	EventsPath   = "/__mill/bridge/events"
	ResultPath   = "/__mill/bridge/result"
	PairPath     = "/__mill/bridge/pair"
	TestPagePath = "/__mill/bridge/test-page"
	// TestDownloadPath serves the fixture file the test page's own
	// download link points at (goal 0350 S3) -- same loopback-only, no-
	// token gate as TestPagePath, for the same reason: a browser
	// following a link cannot carry an Authorization header.
	TestDownloadPath = "/__mill/bridge/test-download"
	RootPath         = "/"
)

// maxResultBytes caps a result POST. A step result carries a status, a
// sentence and at most a small extracted string -- never page content.
const maxResultBytes = 64 * 1024

// Handler builds the bridge's routes.
//
// Two rules hold across all four, and neither is the usual one:
//
//   - The stream, the result intake and the hook door require a paired
//     credential EVEN OVER LOOPBACK. Every other Mill surface trusts a
//     loopback connection, because a loopback connection is the desktop
//     webview. Here it is not: any page or process on this machine can
//     reach a loopback listener, and these routes drive the user's
//     logged-in tabs and workflows. Pairing, not origin, is the
//     credential.
//   - Pairing and the test page require LOOPBACK, and carry no token.
//     A code exchange has no token yet, and a page a browser is about
//     to load cannot send an Authorization header at all.
//
//wails:ignore
func (s *BridgeService) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc(EventsPath, s.handleEvents)
	mux.HandleFunc(ResultPath, s.handleResult)
	mux.HandleFunc(PairPath, s.handlePair)
	mux.HandleFunc(TestPagePath, s.handleTestPage)
	mux.HandleFunc(TestDownloadPath, s.handleTestDownload)
	mux.HandleFunc(HookEventPath, s.handleHookEvent)
	// "{$}" (Go 1.22+ ServeMux) matches ONLY the exact root path -- a
	// bare "/" pattern would instead catch every unmatched path on this
	// mux, turning a real typo into a false 200.
	mux.HandleFunc(RootPath+"{$}", s.handleRoot)
	return mux
}

// handlePair exchanges a pairing code for a browser's bearer token.
func (s *BridgeService) handlePair(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !isLoopback(r) {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	actorSource := "browser:" + sourceKey(r)
	var body struct {
		Code  string `json:"code"`
		Label string `json:"label"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxResultBytes)).Decode(&body); err != nil {
		s.recordCommand(r.Context(), "pair", audit.Target{}, actorSource, "rejected", "", http.StatusBadRequest, "")
		writeUserError(w, http.StatusBadRequest, usererror.New("bad-pairing-request", "That pairing request wasn't readable."))
		return
	}
	pairing, err := s.auth.PairBrowser(body.Code, body.Label, sourceKey(r))
	if err != nil {
		s.recordCommand(r.Context(), "pair", audit.Target{}, actorSource, "rejected", pairFailureKind(err), http.StatusUnauthorized, "")
		writeUserError(w, http.StatusUnauthorized, err)
		return
	}
	s.recordCommand(r.Context(), "pair", audit.Target{Kind: "browser", ID: pairing.DeviceID, Label: pairing.Label}, "browser:"+pairing.DeviceID, "accepted", "", http.StatusOK, "")
	writeJSON(w, http.StatusOK, pairing)
}

// pairFailureKind classifies a PairBrowser error into the audit row's
// FailureKind -- the goal 0351 item 7 contract's own "401/rate-limit"
// pair (CodePairingLockedOut is remoteauthsvc's own rate-limit code;
// every other pairing error reads as an ordinary unauthorized attempt).
func pairFailureKind(err error) string {
	var declared *usererror.Error
	if errors.As(err, &declared) && declared.Code == remoteauthsvc.CodePairingLockedOut {
		return "rate-limited"
	}
	return "unauthorized"
}

// rootPageHTML is what a human meets pasting the bridge's own address
// into a browser instead of the extension's popup, rather than Go's
// bare "404 page not found". No token, no external assets: whoever
// reaches this has no credential yet and this page is not the app.
const rootPageHTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Mill</title>
<style>
 body { font: 15px/1.5 system-ui, sans-serif; margin: 3rem auto; max-width: 32rem; padding: 0 1rem; }
 h1 { font-size: 1.1rem; }
</style>
</head>
<body>
<h1>Mill's connection endpoint</h1>
<p>This is Mill's local connection endpoint. It only answers requests from this computer.</p>
<p>The browser extension and hook recipes talk to it here.</p>
<p>Open Mill, then go to Settings &gt; Connections.</p>
</body>
</html>
`

// handleRoot answers the bridge's own address for a human, not a tool
// -- loopback-gated and token-free the same way the pairing exchange
// and the test page are: nothing that reaches this listener from
// outside this Mac carries a credential yet, or should learn Mill's
// bridge exists at all.
func (s *BridgeService) handleRoot(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !isLoopback(r) {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	_, _ = w.Write([]byte(rootPageHTML))
}

// handleEvents is the one long-lived stream: server-sent events, one
// JSON envelope per message, plus a keepalive every
// browserbridge.KeepaliveSeconds. The keepalive is not cosmetic -- a
// browser extension's service worker is torn down when idle, and a
// chunk arriving on this stream is what keeps it alive to receive the
// next command.
func (s *BridgeService) handleEvents(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	device, ok := s.auth.ValidateBrowserToken(bearerToken(r))
	if !ok {
		writeUserError(w, http.StatusUnauthorized, browserbridge.ErrNoBrowser())
		return
	}
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.WriteHeader(http.StatusOK)
	flusher.Flush()

	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()
	c := s.addClient(device.ID, device.Label, cancel)
	defer s.removeClient(c)
	s.logger.Info("browser bridge: browser connected", "browser", device.ID, "label", device.Label)
	defer s.logger.Info("browser bridge: browser disconnected", "browser", device.ID)

	ticker := time.NewTicker(s.keepalive)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case command := <-c.commands:
			if !writeEvent(w, flusher, command) {
				return
			}
		case <-ticker.C:
			// Re-checked on every keepalive rather than only at connect:
			// revoking a browser in Settings must end its stream, not
			// merely stop the next one from opening.
			if _, still := s.auth.ValidateBrowserToken(bearerToken(r)); !still {
				return
			}
			if !writeEvent(w, flusher, browserbridge.Command{Kind: browserbridge.KindPing}) {
				return
			}
		}
	}
}

// writeEvent writes one SSE frame, reporting whether the stream is
// still usable.
func writeEvent(w http.ResponseWriter, flusher http.Flusher, command browserbridge.Command) bool {
	payload, err := marshalCommand(command)
	if err != nil {
		return false
	}
	if _, err := w.Write([]byte("data: " + string(payload) + "\n\n")); err != nil {
		return false
	}
	flusher.Flush()
	return true
}

// handleResult files one step result, or the final result that closes
// a run.
func (s *BridgeService) handleResult(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	device, ok := s.auth.ValidateBrowserToken(bearerToken(r))
	if !ok {
		s.recordCommand(r.Context(), "result", audit.Target{}, "browser:"+sourceKey(r), "rejected", "unauthorized", http.StatusUnauthorized, "")
		writeUserError(w, http.StatusUnauthorized, browserbridge.ErrNoBrowser())
		return
	}
	var result browserbridge.Result
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxResultBytes)).Decode(&result); err != nil {
		s.recordCommand(r.Context(), "result", audit.Target{}, "browser:"+device.ID, "rejected", "", http.StatusBadRequest, "")
		http.Error(w, "unreadable result", http.StatusBadRequest)
		return
	}
	if strings.TrimSpace(result.ID) == "" {
		s.recordCommand(r.Context(), "result", audit.Target{}, "browser:"+device.ID, "rejected", "", http.StatusBadRequest, "")
		http.Error(w, "a result needs a run id", http.StatusBadRequest)
		return
	}
	// The 204 success path is deliberately NOT audited here -- a
	// multi-step flow posts one result per step, and the owning Replay
	// call's own audit row already captures the whole run's outcome;
	// auditing every step POST would spam the trail with one row per
	// step rather than one per command.
	s.recordResult(result)
	w.WriteHeader(http.StatusNoContent)
}

// addClient registers a connected browser as the newest one.
func (s *BridgeService) addClient(deviceID, label string, cancel context.CancelFunc) *client {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.seq++
	c := &client{seq: s.seq, deviceID: deviceID, label: label, commands: make(chan browserbridge.Command, commandBuffer), cancel: cancel}
	s.clients = append(s.clients, c)
	return c
}

func (s *BridgeService) removeClient(target *client) {
	s.mu.Lock()
	defer s.mu.Unlock()
	kept := s.clients[:0]
	for _, c := range s.clients {
		if c.seq == target.seq {
			continue
		}
		kept = append(kept, c)
	}
	s.clients = kept
}

// bearerToken reads the Authorization header's bearer value, "" when
// absent or shaped otherwise.
func bearerToken(r *http.Request) string {
	raw := r.Header.Get("Authorization")
	const prefix = "Bearer "
	if !strings.HasPrefix(raw, prefix) {
		return ""
	}
	return strings.TrimSpace(strings.TrimPrefix(raw, prefix))
}

// isLoopback decides origin from the actual TCP connection only, never
// from a client-settable header -- trusting one would let any caller
// simply claim to be local. An unparseable address is treated as
// non-loopback.
func isLoopback(r *http.Request) bool {
	ip := remoteIP(r)
	return ip != nil && ip.IsLoopback()
}

// sourceKey is the pairing rate limiter's bucket: the connection's own
// remote IP, same never-trust-headers rule as isLoopback.
func sourceKey(r *http.Request) string {
	if ip := remoteIP(r); ip != nil {
		return ip.String()
	}
	return r.RemoteAddr
}

func remoteIP(r *http.Request) net.IP {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	return net.ParseIP(host)
}

// writeJSON writes one JSON body with its status.
func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

// writeUserError answers with the declared code and sentence when the
// failure has one, and a generic pair when it does not -- an internal
// chain never crosses this boundary, same rule as the Wails one.
func writeUserError(w http.ResponseWriter, status int, err error) {
	code, message := usererror.CodeUnexpected, usererror.UnexpectedMessage
	var declared *usererror.Error
	if errors.As(err, &declared) {
		code, message = declared.Code, declared.Message
	}
	writeJSON(w, status, map[string]string{"code": code, "error": message})
}
