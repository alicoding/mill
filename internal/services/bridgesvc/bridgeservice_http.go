package bridgesvc

import (
	"context"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/alicoding/mill/internal/domain/browserbridge"
	"github.com/alicoding/mill/internal/domain/usererror"
)

// The bridge's four routes. Everything lives under one prefix so a
// future mount alongside other handlers can never collide with an app
// route.
const (
	EventsPath   = "/__mill/bridge/events"
	ResultPath   = "/__mill/bridge/result"
	PairPath     = "/__mill/bridge/pair"
	TestPagePath = "/__mill/bridge/test-page"
)

// maxResultBytes caps a result POST. A step result carries a status, a
// sentence and at most a small extracted string -- never page content.
const maxResultBytes = 64 * 1024

// Handler builds the bridge's routes.
//
// Two rules hold across all four, and neither is the usual one:
//
//   - The stream and the result intake require a paired browser token
//     EVEN OVER LOOPBACK. Every other Mill surface trusts a loopback
//     connection, because a loopback connection is the desktop webview.
//     Here it is not: any page or process on this machine can reach a
//     loopback listener, and this one drives the user's logged-in tabs.
//     Pairing, not origin, is the credential.
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
	var body struct {
		Code  string `json:"code"`
		Label string `json:"label"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxResultBytes)).Decode(&body); err != nil {
		writeUserError(w, http.StatusBadRequest, usererror.New("bad-pairing-request", "That pairing request wasn't readable."))
		return
	}
	pairing, err := s.auth.PairBrowser(body.Code, body.Label, sourceKey(r))
	if err != nil {
		writeUserError(w, http.StatusUnauthorized, err)
		return
	}
	writeJSON(w, http.StatusOK, pairing)
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
	if _, ok := s.auth.ValidateBrowserToken(bearerToken(r)); !ok {
		writeUserError(w, http.StatusUnauthorized, browserbridge.ErrNoBrowser())
		return
	}
	var result browserbridge.Result
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxResultBytes)).Decode(&result); err != nil {
		http.Error(w, "unreadable result", http.StatusBadRequest)
		return
	}
	if strings.TrimSpace(result.ID) == "" {
		http.Error(w, "a result needs a run id", http.StatusBadRequest)
		return
	}
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
