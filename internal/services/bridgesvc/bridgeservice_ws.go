package bridgesvc

import (
	"context"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/alicoding/mill/internal/domain/browserbridge"
	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
)

// The WebSocket channel and the connected-client registry (goal 0418),
// split from bridgeservice_http.go at the 500-line convention
// (.claude/rules/architecture.md): everything here is either the one
// long-lived socket handler or the client bookkeeping only that
// handler and beginRun (bridgeservice.go) touch. wsTokenSubprotocol is
// the Sec-WebSocket-Protocol prefix a browser's WebSocket constructor
// carries the bearer token under -- the browser platform's WebSocket
// cannot set an Authorization header, and a subprotocol is the one
// request field its own constructor exposes.
const wsTokenSubprotocol = "mill-token."

// wsToken reads the bearer token a browser's WebSocket carries as its
// Sec-WebSocket-Protocol value -- the constructor's own second
// argument, the only field a page's WebSocket can set that this
// listener can authenticate against. "" means no well-formed token
// subprotocol was offered at all.
func wsToken(r *http.Request) string {
	for _, raw := range r.Header.Values("Sec-WebSocket-Protocol") {
		for _, tok := range strings.Split(raw, ",") {
			tok = strings.TrimSpace(tok)
			if strings.HasPrefix(tok, wsTokenSubprotocol) {
				return strings.TrimPrefix(tok, wsTokenSubprotocol)
			}
		}
	}
	return ""
}

// originHost is the host coder/websocket's own Origin check compares
// an incoming request's Origin header against (accept.go's
// authenticateOrigin: url.Parse(origin).Host, matched literally since
// none of ours contain glob characters) -- a real extension's Origin
// is "chrome-extension://<id>", whose "host" is the extension id
// itself. "" (an unparseable origin) matches nothing, refusing rather
// than silently widening.
func originHost(origin string) string {
	u, err := url.Parse(origin)
	if err != nil {
		return ""
	}
	return u.Host
}

// wsAcceptOptions builds handleWS's own AcceptOptions, bound to the
// credential's recorded Origin when one exists, or to whatever Origin
// this connection presents when none does yet -- learnOnAccept tells
// the caller whether to persist that presented Origin once Accept
// actually succeeds (goal 0418's legacy-credential bootstrap).
func (s *BridgeService) wsAcceptOptions(r *http.Request, deviceID, token string) (opts *websocket.AcceptOptions, requestOrigin string, learnOnAccept bool) {
	requestOrigin = r.Header.Get("Origin")
	knownOrigin, boundAlready := s.auth.BrowserOrigin(deviceID)
	opts = &websocket.AcceptOptions{Subprotocols: []string{wsTokenSubprotocol + token}}
	switch {
	case boundAlready:
		opts.OriginPatterns = []string{originHost(knownOrigin)}
	case requestOrigin != "":
		opts.OriginPatterns = []string{originHost(requestOrigin)}
	}
	return opts, requestOrigin, !boundAlready && requestOrigin != ""
}

// handleWS is the one long-lived channel: a WebSocket, one JSON
// envelope per message, plus a keepalive DATA message every
// browserbridge.KeepaliveSeconds. The keepalive is not cosmetic -- a
// browser extension's service worker is torn down when idle, and a
// WebSocket message is one of the events Chrome (116+) counts as
// activity that resets that timer.
//
// The token is validated and the subprotocol negotiated BEFORE
// websocket.Accept runs: Accept writes its own response on any error,
// so refusing here first is what keeps the 401 the extension's own
// discover/pair flow already expects. The socket is also bound to the
// credential's own recorded Origin (goal 0418) via coder/websocket's
// own OriginPatterns door -- a mismatch is Accept's own 403, not
// something this handler decides. A credential paired before Origin
// binding existed has none recorded yet: its first connection is
// trusted with whatever Origin it presents (there is nothing yet to
// compare it against), and RecordBrowserOrigin below learns it for
// every connection after.
func (s *BridgeService) handleWS(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	token := wsToken(r)
	device, ok := s.auth.ValidateBrowserToken(token)
	if token == "" || !ok {
		writeUserError(w, http.StatusUnauthorized, browserbridge.ErrNoBrowser())
		return
	}

	opts, requestOrigin, learnOnAccept := s.wsAcceptOptions(r, device.ID, token)
	conn, err := websocket.Accept(w, r, opts)
	if err != nil {
		s.logger.Info("browser bridge: websocket accept failed", "browser", device.ID, "error", err)
		return
	}
	if learnOnAccept {
		s.auth.RecordBrowserOrigin(device.ID, requestOrigin)
	}
	defer func() { _ = conn.Close(websocket.StatusNormalClosure, "") }()

	// The extension never sends a data message on this socket -- only
	// Mill writes. CloseRead owns the read side so control frames
	// (ping/pong/close) still get answered, and its returned context is
	// this handler's own disconnect signal.
	connCtx := conn.CloseRead(r.Context())
	c := s.addClient(device.ID, device.Label, func() { _ = conn.Close(websocket.StatusGoingAway, "server shutting down") })
	defer s.removeClient(c)
	s.logger.Info("browser bridge: browser connected", "browser", device.ID, "label", device.Label)
	defer s.logger.Info("browser bridge: browser disconnected", "browser", device.ID)

	s.pumpWS(r.Context(), connCtx, conn, c, token)
}

// pumpWS is handleWS's own write loop, split out at the 15-point
// cognitive-complexity gate (gocognit-new): one connected browser's
// commands and keepalives, until the socket closes or a revoked
// token's next keepalive tick ends it.
func (s *BridgeService) pumpWS(ctx, connCtx context.Context, conn *websocket.Conn, c *client, token string) {
	ticker := time.NewTicker(s.keepalive)
	defer ticker.Stop()
	for {
		select {
		case <-connCtx.Done():
			return
		case command := <-c.commands:
			if wsjson.Write(ctx, conn, command) != nil {
				return
			}
		case <-ticker.C:
			// Re-checked on every keepalive rather than only at connect:
			// revoking a browser in Settings must end its socket, not
			// merely stop the next one from opening.
			if _, still := s.auth.ValidateBrowserToken(token); !still {
				return
			}
			if wsjson.Write(ctx, conn, browserbridge.Command{Kind: browserbridge.KindKeepalive}) != nil {
				return
			}
		}
	}
}

// addClient registers a connected browser as the newest one, and wakes
// every beginRun currently waiting for exactly this (closing arrived is
// a broadcast every such waiter's own select already listens on; the
// fresh channel is what the NEXT wait blocks on).
func (s *BridgeService) addClient(deviceID, label string, cancel context.CancelFunc) *client {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.seq++
	c := &client{seq: s.seq, deviceID: deviceID, label: label, commands: make(chan browserbridge.Command, commandBuffer), cancel: cancel}
	s.clients = append(s.clients, c)
	close(s.arrived)
	s.arrived = make(chan struct{})
	return c
}

// hasClient reports whether deviceID currently holds a live socket --
// the discover door's own "connected" fact, distinct from "paired".
func (s *BridgeService) hasClient(deviceID string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, c := range s.clients {
		if c.deviceID == deviceID {
			return true
		}
	}
	return false
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
