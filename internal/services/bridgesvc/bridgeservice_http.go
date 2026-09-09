package bridgesvc

import (
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"strings"

	"github.com/alicoding/mill/internal/domain/audit"
	"github.com/alicoding/mill/internal/domain/browserbridge"
	"github.com/alicoding/mill/internal/domain/usererror"
	"github.com/alicoding/mill/internal/services/remoteauthsvc"
)

// The bridge's browser routes. Everything lives under one prefix so a
// future mount alongside other handlers can never collide with an app
// route. The webhook door's own route constant lives with its handler
// in bridgeservice_webhook.go. RootPath is the exception: it is the
// listener's own address, answered for a human who pastes it into a
// browser rather than a tool that reads it (goal 0369). DiscoverPath,
// PairRequestPath and PairStatusPath are goal 0379's Bluetooth-style
// nearby flow: a browser's popup finds Mill and requests pairing
// without typing anything, confirmed by a matching code Accept/Deny in
// Mill resolves -- PairPath's typed exchange stays as the Passkey-
// Entry-equivalent fallback. DisconnectPath (goal 0379 S2) lets a
// paired browser end its OWN pairing by presenting its own bearer
// token -- kept beside PairPath as the mint/revoke pair for the same
// credential.
const (
	WSPath          = "/__mill/bridge/ws"
	ResultPath      = "/__mill/bridge/result"
	PairPath        = "/__mill/bridge/pair"
	DisconnectPath  = "/__mill/bridge/disconnect"
	DiscoverPath    = "/__mill/bridge/discover"
	PairRequestPath = "/__mill/bridge/pair-request"
	PairStatusPath  = "/__mill/bridge/pair-status"
	TestPagePath    = "/__mill/bridge/test-page"
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
//   - The stream, the result intake and the webhook door require a paired
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
	mux.HandleFunc(WSPath, s.handleWS)
	mux.HandleFunc(ResultPath, s.handleResult)
	mux.HandleFunc(PairPath, s.handlePair)
	mux.HandleFunc(DisconnectPath, s.handleDisconnect)
	mux.HandleFunc(DiscoverPath, s.handleDiscover)
	mux.HandleFunc(PairRequestPath, s.handlePairRequest)
	mux.HandleFunc(PairStatusPath, s.handlePairStatus)
	mux.HandleFunc(TestPagePath, s.handleTestPage)
	mux.HandleFunc(TestDownloadPath, s.handleTestDownload)
	mux.HandleFunc(WebhookPath, s.handleWebhook)
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
	pairing, err := s.auth.PairBrowser(body.Code, body.Label, sourceKey(r), r.Header.Get("Origin"))
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

// handleDisconnect ends the CALLER's own pairing (goal 0379 S2): the
// bearer token is the only proof of identity accepted -- a request body
// naming a different device id is decoded for nothing, never read, so a
// browser can only ever revoke itself. Unlike handlePair/handleDiscover
// it carries no isLoopback gate: the token IS the credential, valid the
// same way over loopback or a remote connection, mirroring
// handleEvents/handleResult's own bearer-only posture rather than the
// no-token-yet pairing doors.
func (s *BridgeService) handleDisconnect(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	device, ok := s.auth.ValidateBrowserToken(bearerToken(r))
	if !ok {
		s.recordCommand(r.Context(), "revoke", audit.Target{}, "browser:"+sourceKey(r), "rejected", "unauthorized", http.StatusUnauthorized, "")
		writeUserError(w, http.StatusUnauthorized, browserbridge.ErrNoBrowser())
		return
	}
	if err := s.auth.RevokeDevice(device.ID); err != nil {
		// Already gone -- a concurrent duplicate Disconnect, or the
		// same device revoked from Settings a moment earlier. The
		// caller's desired end state (unpaired) already holds, so this
		// still answers 204 rather than surfacing a race as a failure.
		s.logger.Info("browser bridge: disconnect for an already-revoked device", "browser", device.ID)
	}
	s.recordCommand(r.Context(), "revoke", audit.Target{Kind: "browser", ID: device.ID, Label: device.Label}, "browser:"+device.ID, "accepted", "", http.StatusNoContent, "")
	w.WriteHeader(http.StatusNoContent)
}

// discoverResponse is what a browser's popup learns before typing
// anything (goal 0379): Mill is here, whether THIS caller is already
// paired, and whether its credential holds a live socket right now
// (goal 0418) -- paired and connected are two separate facts, never
// conflated into one "Connected" the popup used to report on pairing
// alone.
type discoverResponse struct {
	Name      string `json:"name"`
	Paired    bool   `json:"paired"`
	Connected bool   `json:"connected"`
}

// handleDiscover answers the Bluetooth-style nearby flow's first
// question, loopback-gated and token-free like handlePair and
// handleTestPage -- a popup that has never paired has no bearer to
// send. Paired reflects THIS caller specifically: any bearer token it
// already holds is checked against the live paired list, so a popup
// that still has a good token skips straight to reporting its live
// state without a second round trip, and one whose token was since
// revoked learns that too rather than reading a stale local flag.
// Connected is true only while THIS credential also holds an open
// socket -- a paired browser whose worker went idle is Paired but not
// Connected, and the popup's own reconnect view is what tells the
// difference.
func (s *BridgeService) handleDiscover(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !isLoopback(r) {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	device, paired := s.auth.ValidateBrowserToken(bearerToken(r))
	connected := paired && s.hasClient(device.ID)
	writeJSON(w, http.StatusOK, discoverResponse{Name: "Mill", Paired: paired, Connected: connected})
}

// handlePairRequest mints a pairing REQUEST -- not a credential -- for
// the nearby flow's numeric-comparison step: the same code goes to the
// caller here and to Settings > Connections > Browsers' own
// incoming-request card, and only a human clicking Accept there ever
// turns it into a token (goal 0379). Loopback-gated and token-free
// like handlePair, and shares handlePair's own rate-limit bucket via
// sourceKey so a lockout from repeated bad pairing codes also blocks a
// flood of pairing requests from the same source.
func (s *BridgeService) handlePairRequest(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !isLoopback(r) {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	var body struct {
		Label string `json:"label"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxResultBytes)).Decode(&body); err != nil {
		writeUserError(w, http.StatusBadRequest, usererror.New("bad-pairing-request", "That pairing request wasn't readable."))
		return
	}
	info, err := s.auth.RequestPairing(body.Label, sourceKey(r), r.Header.Get("Origin"))
	if err != nil {
		writeUserError(w, http.StatusUnauthorized, err)
		return
	}
	writeJSON(w, http.StatusOK, info)
}

// handlePairStatus is what a popup polls once a second while a request
// is pending (goal 0379): pending/accepted/denied/expired, the SAME
// shape PairBrowser's response takes on acceptance. A stale or unknown
// requestId reads exactly like "expired" -- handled entirely inside
// PairingStatus, never distinguished here, so a guess learns nothing.
func (s *BridgeService) handlePairStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !isLoopback(r) {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	writeJSON(w, http.StatusOK, s.auth.PairingStatus(r.URL.Query().Get("requestId")))
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
<p>The browser extension's discovery check, its pairing, its disconnect, and webhook recipes all talk to it here.</p>
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
