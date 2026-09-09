package remoteauthsvc

import (
	"strings"
	"time"

	"github.com/alicoding/mill/internal/domain/usererror"
)

// KindDevice and KindBrowser are the two things that can pair.
// KindDevice is the empty string on purpose: every record written
// before browsers existed is a phone or a computer, and stays one
// without a migration pass.
const (
	KindDevice  = ""
	KindBrowser = "browser"
)

// browserLabelFallback names a browser that announced nothing about
// itself, so a Settings row is never blank.
const browserLabelFallback = "Browser"

// BrowserPairing is what a browser extension receives once it presents
// a valid code: the bearer token it stores locally, and the id/label
// Settings shows for it. The token is returned exactly once and never
// retrievable again -- only its salted hash is kept.
type BrowserPairing struct {
	Token    string `json:"token"`
	DeviceID string `json:"deviceId"`
	Label    string `json:"label"`
}

// CodeBadPairingCode is the handle for a code that was wrong, already
// used, or past its five minutes.
const CodeBadPairingCode = "bad-pairing-code"

// CodePairingLockedOut is the handle for a source that has failed too
// many times recently.
const CodePairingLockedOut = "pairing-locked-out"

// PairBrowser exchanges a live pairing code for a browser's own bearer
// token, minting a paired record of KindBrowser. It runs through the
// SAME single-live-code, single-use, five-minute rules and the SAME
// per-source rate limiter a device pairing does -- a browser is a
// paired thing like any other, not a second trust model.
//
// source is the caller's connection key (the bridge passes the
// request's remote IP) so a scripted guessing loop locks out exactly
// like a hand-typed one. origin is the pairing request's own Origin
// header (goal 0418) -- recorded on the minted credential so the
// bridge's WebSocket door can bind to it later; "" (no header, or a
// caller that never passes one) leaves the credential to learn its
// origin on its first connect instead (RecordBrowserOrigin).
//
// Exported for the bridge's HTTP handler, never for the frontend: a
// bound RPC returning a raw token would hand every page in the webview
// a credential it has no business holding.
//
//wails:ignore
func (s *RemoteAuthService) PairBrowser(code, label, source, origin string) (BrowserPairing, error) {
	now := time.Now()

	s.mu.Lock()
	if allowed, _ := s.checkRateLimit(source, now); !allowed {
		s.mu.Unlock()
		return BrowserPairing{}, usererror.New(CodePairingLockedOut, "Too many wrong codes. Wait a minute and try again.")
	}
	candidate := strings.ToUpper(strings.TrimSpace(code))
	if !s.validatePairingCode(candidate, now) {
		s.recordPairingFailure(source, now)
		s.mu.Unlock()
		return BrowserPairing{}, usererror.New(CodeBadPairingCode, "That code didn't work. Generate a new one and try again.")
	}
	s.recordPairingSuccess(source)
	token, err := s.mintDevice(browserLabel(label), "", KindBrowser)
	if err != nil {
		s.mu.Unlock()
		return BrowserPairing{}, err
	}
	if origin != "" {
		s.devices[len(s.devices)-1].Origin = origin
		if err := s.saveDevices(); err != nil {
			s.logger.Error("remote access: recording browser origin", "error", err)
		}
	}
	minted := s.devices[len(s.devices)-1]
	s.mu.Unlock()

	s.logger.Info("browser bridge: browser paired", "device", minted.ID, "label", minted.Label)
	return BrowserPairing{Token: token, DeviceID: minted.ID, Label: minted.Label}, nil
}

// BrowserOrigin returns a paired browser credential's own recorded
// Origin (goal 0418) and whether one has been recorded yet -- false
// for a credential paired before this field existed that has not yet
// connected once (RecordBrowserOrigin learns it there), or for an
// unknown id.
//
// Exported for the bridge's HTTP handler, never for the frontend.
//
//wails:ignore
func (s *RemoteAuthService) BrowserOrigin(deviceID string) (string, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, d := range s.devices {
		if d.ID == deviceID && d.Kind == KindBrowser {
			return d.Origin, d.Origin != ""
		}
	}
	return "", false
}

// RecordBrowserOrigin persists the Origin a legacy credential's first
// WebSocket connection presented (goal 0418): a device paired before
// this field existed has none recorded, so the bridge's WS door
// accepts that first connection unconditionally and learns its origin
// here, enforcing it on every connection after. A no-op once a
// credential already has one, and for an id that no longer resolves to
// a browser -- both are races the caller cannot prevent and neither is
// worth failing the connection that already succeeded over.
//
// Exported for the bridge's HTTP handler, never for the frontend.
//
//wails:ignore
func (s *RemoteAuthService) RecordBrowserOrigin(deviceID, origin string) {
	s.mu.Lock()
	matchedIndex := -1
	for i, d := range s.devices {
		if d.ID == deviceID && d.Kind == KindBrowser {
			matchedIndex = i
			break
		}
	}
	if matchedIndex == -1 || s.devices[matchedIndex].Origin != "" {
		s.mu.Unlock()
		return
	}
	s.devices[matchedIndex].Origin = origin
	if err := s.saveDevices(); err != nil {
		s.logger.Error("remote access: recording browser origin", "error", err)
	}
	s.mu.Unlock()
	s.logger.Info("browser bridge: learned browser origin on first connect", "device", deviceID)
}

// ValidateBrowserToken reports whether token names a live paired
// browser, refreshing its last-seen stamp. A token belonging to a
// phone or another computer is refused here even though it is a valid
// credential elsewhere (validateToken's kind check).
//
// Exported for the bridge's HTTP handler, never for the frontend.
//
//wails:ignore
func (s *RemoteAuthService) ValidateBrowserToken(token string) (DeviceInfo, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.validateToken(token, "", KindBrowser, time.Now())
}

// browserLabel trims and caps a browser's self-announced name, falling
// back rather than leaving a Settings row blank.
func browserLabel(raw string) string {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return browserLabelFallback
	}
	if len(trimmed) > deviceLabelMaxLen {
		trimmed = trimmed[:deviceLabelMaxLen]
	}
	return trimmed
}
