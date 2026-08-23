package remoteauthsvc

import (
	"net"
	"net/http"
	"strings"
	"time"
)

// PairSubmitPath is the only path an unpaired non-loopback request
// may POST a code to. Every other path/verb combination for an
// unpaired request gets the same standalone pairing page (SLICE 1
// DESIGN CONTRACT: "never the app, never a partial app shell").
const PairSubmitPath = "/__mill/pair"

// ResendSubmitPath is the pairing page's "Get a new code" action
// (SLICE 2 DESIGN CONTRACT item 2) -- unauthenticated like
// PairSubmitPath, and reachable by the same unpaired non-loopback
// caller the pairing page itself is served to.
const ResendSubmitPath = "/__mill/resend"

// pairingCodeFormKey is the pairing page's single form field.
const pairingCodeFormKey = "code"

// cookieLifetime is how long a paired device's cookie lasts before
// the browser drops it on its own. Pairing is meant to persist across
// sessions until explicitly revoked (Settings > Remote access), so
// this is deliberately long -- revocation, not expiry, is the
// intended un-pairing path.
const cookieLifetime = 365 * 24 * time.Hour

// Middleware is the application.Options.Assets.Middleware hook: one
// wrapper in front of every path the AssetServer serves -- assets,
// RPC, and websocket upgrades alike, since Wails injects this
// middleware before any of its own internal ones. It challenges by
// connection ORIGIN, never by build mode (SLICE 1 DESIGN CONTRACT):
// loopback connections -- the desktop webview -- pass through
// untouched, and every other connection must carry a valid
// device-token cookie or complete pairing first. The phone channel's
// ntfy subscribe path (remoteauthservice_ntfy.go) is checked BEFORE
// any of that, deliberately: the ntfy client sends no device cookie,
// so that one path answers by topic instead of by origin or token
// (docs/goals/0132 SLICE B item 2).
//
// Exported for main.go's own construction flow, not a frontend RPC --
// a func(http.Handler) http.Handler return type can't cross the
// Wails bridge anyway.
//
//wails:ignore
func (s *RemoteAuthService) Middleware() func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if topic, ok := ntfyTopicFromPath(r); ok {
				s.handleNtfySubscribe(w, r, topic)
				return
			}

			if isLoopback(r) {
				next.ServeHTTP(w, r)
				return
			}

			if s.tokenIsValid(r) {
				next.ServeHTTP(w, r)
				return
			}

			if r.Method == http.MethodPost && r.URL.Path == PairSubmitPath {
				s.handlePairSubmit(w, r)
				return
			}
			if r.Method == http.MethodPost && r.URL.Path == ResendSubmitPath {
				s.handleResendSubmit(w, r)
				return
			}

			s.writePairingResponse(w, http.StatusUnauthorized, pairingPageState{})
		})
	}
}

// writePairingResponse renders the pairing page with status, filling
// in the per-mode Instructions from the service before writing --
// every response path (the challenge itself, a wrong code, a
// lockout, a successful resend) shares this so the truthful copy
// (SLICE 2 DESIGN CONTRACT item 1) can never be forgotten on one
// branch.
func (s *RemoteAuthService) writePairingResponse(w http.ResponseWriter, status int, state pairingPageState) {
	state.Instructions = s.pairingInstructions()
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(status)
	writePairingPage(w, state)
}

// isLoopback determines origin from the actual TCP connection's
// remote address ONLY. It never reads a client-controllable header
// (X-Forwarded-For, Host, ...) -- those are set by the request itself,
// so trusting them would let any non-loopback client simply claim to
// be loopback. A RemoteAddr this can't parse is treated as
// non-loopback (fail closed), never assumed safe.
func isLoopback(r *http.Request) bool {
	// An EMPTY RemoteAddr means the request never crossed a socket: the
	// desktop build serves its assets in-process to its own webview.
	// net/http always sets RemoteAddr for a real connection, so this
	// cannot admit a network caller -- and without it the gate
	// challenges the desktop app against itself, a state nothing can
	// pair out of (BootstrapPairingCode only mints in server mode).
	if strings.TrimSpace(r.RemoteAddr) == "" {
		return true
	}
	ip := remoteIP(r)
	return ip != nil && ip.IsLoopback()
}

// sourceKeyForRequest is the rate limiter's bucket key: the
// connection's remote IP, same fail-closed parsing as isLoopback and
// the same never-trust-headers constraint.
func sourceKeyForRequest(r *http.Request) string {
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

// tokenIsValid reads the device-token cookie, if any, and checks it
// against the paired-device store.
func (s *RemoteAuthService) tokenIsValid(r *http.Request) bool {
	cookie, err := r.Cookie(DeviceTokenCookieName)
	if err != nil || cookie.Value == "" {
		return false
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.validateToken(cookie.Value, baseURLFor(r), time.Now())
}

// handlePairSubmit processes a pairing-code form submission: rate
// limit, then validate, then mint a device and set its cookie on
// success. Every branch renders the same pairing page shape, never
// app content.
func (s *RemoteAuthService) handlePairSubmit(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseForm(); err != nil {
		s.writePairingResponse(w, http.StatusBadRequest, pairingPageState{ErrorMessage: pairingErrorGeneric})
		return
	}

	source := sourceKeyForRequest(r)
	now := time.Now()

	s.mu.Lock()
	if allowed, retryAfter := s.checkRateLimit(source, now); !allowed {
		s.mu.Unlock()
		s.writePairingResponse(w, http.StatusTooManyRequests, pairingPageState{ErrorMessage: pairingLockoutMessage(retryAfter)})
		return
	}

	candidate := strings.ToUpper(strings.TrimSpace(r.FormValue(pairingCodeFormKey)))
	if !s.validatePairingCode(candidate, now) {
		s.recordPairingFailure(source, now)
		s.mu.Unlock()
		s.writePairingResponse(w, http.StatusUnauthorized, pairingPageState{ErrorMessage: pairingErrorWrongCode})
		return
	}
	s.recordPairingSuccess(source)
	token, err := s.mintDevice(deviceLabelFor(r), baseURLFor(r))
	s.mu.Unlock()
	if err != nil {
		s.logger.Error("remote access: minting device token", "error", err)
		s.writePairingResponse(w, http.StatusInternalServerError, pairingPageState{ErrorMessage: pairingErrorGeneric})
		return
	}

	setDeviceCookie(w, r, token)
	http.Redirect(w, r, "/", http.StatusSeeOther)
}

// handleResendSubmit is the pairing page's "Get a new code" action
// (SLICE 2 DESIGN CONTRACT item 2): unauthenticated, rate-limited
// through the same per-source limiter as a pairing-code attempt (a
// resend counts as an attempt against that limiter, so spamming this
// alone can still lock a source out), and its ONLY output is a log
// line -- the fresh code never appears in this response, which would
// hand it straight to the very device being challenged.
func (s *RemoteAuthService) handleResendSubmit(w http.ResponseWriter, r *http.Request) {
	source := sourceKeyForRequest(r)
	now := time.Now()

	s.mu.Lock()
	if allowed, retryAfter := s.checkRateLimit(source, now); !allowed {
		s.mu.Unlock()
		s.writePairingResponse(w, http.StatusTooManyRequests, pairingPageState{ErrorMessage: pairingLockoutMessage(retryAfter)})
		return
	}
	s.recordPairingFailure(source, now)
	s.mu.Unlock()

	if _, err := s.resendPairingCode(); err != nil {
		s.logger.Error("remote access: resending pairing code", "error", err)
		s.writePairingResponse(w, http.StatusInternalServerError, pairingPageState{ErrorMessage: pairingErrorGeneric})
		return
	}
	s.writePairingResponse(w, http.StatusOK, pairingPageState{InfoMessage: s.resendConfirmation()})
}

// setDeviceCookie stores the raw device token client-side ONLY --
// the server keeps just its salted hash (remoteauthservice_devices.go
// mintDevice). Secure is set only when the request itself arrived
// over TLS: a plain-HTTP deployment can't mark the cookie Secure
// without the browser refusing to ever send it back.
func setDeviceCookie(w http.ResponseWriter, r *http.Request, token string) {
	//nolint:gosec // G124: HttpOnly/SameSite are always set; Secure is
	// deliberately conditional on r.TLS (SLICE 1 DESIGN CONTRACT:
	// "Secure when the request is TLS") -- a static `true` here would
	// make the cookie unsendable over a plain-HTTP remote deployment.
	http.SetCookie(w, &http.Cookie{
		Name:     DeviceTokenCookieName,
		Value:    token,
		Path:     "/",
		HttpOnly: true,
		Secure:   r.TLS != nil,
		SameSite: http.SameSiteStrictMode,
		Expires:  time.Now().Add(cookieLifetime),
	})
}

// baseURLFor derives the scheme+host a request actually arrived on --
// the exact address that request's device already proved reachable,
// reused for both the phone channel's copyable subscribe URL and a
// delivered notification's click target (remoteauthservice_ntfy.go).
func baseURLFor(r *http.Request) string {
	scheme := "http"
	if r.TLS != nil {
		scheme = "https"
	}
	return scheme + "://" + r.Host
}

// deviceLabelFor derives a human-readable label from the pairing
// request's User-Agent -- the minimal pairing page only asks for a
// code (SLICE 1 DESIGN CONTRACT step 1), never a label, so this is
// the only source Settings > Remote access has for naming a device.
func deviceLabelFor(r *http.Request) string {
	ua := r.UserAgent()
	switch {
	case strings.Contains(ua, "iPhone"):
		return "iPhone"
	case strings.Contains(ua, "iPad"):
		return "iPad"
	case strings.Contains(ua, "Android"):
		return "Android device"
	case strings.Contains(ua, "Macintosh"):
		return "Mac"
	case strings.Contains(ua, "Windows"):
		return "Windows PC"
	case strings.Contains(ua, "Linux"):
		return "Linux device"
	default:
		return "Paired device"
	}
}
