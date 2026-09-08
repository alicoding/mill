package remoteauthsvc

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"math/big"
	"strings"
	"time"

	"github.com/alicoding/mill/internal/domain/notification"
	"github.com/alicoding/mill/internal/domain/usererror"
)

// pairingRequestCodeAlphabet is digits only, distinct from
// pairingCodeAlphabet's hand-typed letters -- Bluetooth-style numeric
// comparison shows the SAME number on both screens for a human to
// compare, never types it (goal 0379's precedent research).
const pairingRequestCodeAlphabet = "0123456789"

// pairingRequestCodeLength and pairingRequestTTL are goal 0379's Plan
// numbers verbatim: an interactive nearby moment, shorter than the
// existing 5-minute typed-code TTL kept for the out-of-band case.
const (
	pairingRequestCodeLength = 6
	pairingRequestTTL        = 2 * time.Minute
)

// The pairing request's lifecycle states -- a stale/mismatched
// requestId reads exactly like Expired (PairingStatus below), never
// distinguishing "wrong id" from "expired" so a guess learns nothing.
const (
	pairingRequestStatusPending  = "pending"
	pairingRequestStatusAccepted = "accepted"
	pairingRequestStatusDenied   = "denied"
	pairingRequestStatusExpired  = "expired"
)

// browserPairRequestEventType is the notification spine's Event.Type
// for an incoming pairing request (goal 0379 Decision 3).
const browserPairRequestEventType = "browser-pair-request"

// browserPairRequestTargets is what RequestPairing publishes as
// Event.Targets (goal 0379 S2), reusing docs/goals/0372's addressing
// convention rather than a Type-specific branch in the phone channel:
// "desktop-only" is not, and will never be, a real paired device id
// (every real one is a deviceIDBytes-byte hex string), so the phone
// channel's own Targets filter (remoteauthservice_ntfy.go's
// ShouldDeliver/Deliver) excludes every phone from it -- Accept only
// ever happens at the desktop Mill the requesting browser is trying to
// reach, never from a phone notification.
var browserPairRequestTargets = []string{"desktop-only"}

// CodePairingRequestNotFound is the handle Accept/Deny answer with
// when requestID names no live pending request -- expired, already
// resolved by the other button, or never existed.
const CodePairingRequestNotFound = "pairing-request-not-found"

// pairingRequest is the single in-memory, on-demand incoming pairing
// request a browser's popup mints from the bridge's discovery flow.
// Never persisted, same as pairingCode.
type pairingRequest struct {
	id        string
	code      string
	label     string
	status    string
	expiresAt time.Time
	token     string
	deviceID  string
}

// PairingRequestInfo is what a browser's popup receives from
// RequestPairing: enough to show the code and start polling
// pair-status, never a credential.
type PairingRequestInfo struct {
	RequestID string    `json:"requestId"`
	Code      string    `json:"code"`
	ExpiresAt time.Time `json:"expiresAt"`
}

// PairingRequestStatus is what a browser's popup polls pair-status
// for: pending while unresolved, accepted with the SAME shape
// PairBrowser returns (so the popup's storage write is unchanged
// whichever path it arrived through), denied/expired otherwise.
type PairingRequestStatus struct {
	Status   string `json:"status"`
	Token    string `json:"token,omitempty"`
	DeviceID string `json:"deviceId,omitempty"`
	Label    string `json:"label,omitempty"`
}

// PendingPairingRequest is Settings > Connections > Browsers' own read
// model for the incoming-request card: the SAME code the popup shows,
// for the human comparison step Accept/Deny confirms. RequestID is ""
// when nothing is pending right now.
type PendingPairingRequest struct {
	RequestID string    `json:"requestId"`
	Code      string    `json:"code"`
	Label     string    `json:"label"`
	ExpiresAt time.Time `json:"expiresAt"`
}

// generatePairingRequestCode draws pairingRequestCodeLength digits via
// crypto/rand, uniformly -- the same rejection-sampling shape
// generateCode already uses for the typed code's alphabet.
func generatePairingRequestCode() (string, error) {
	alphabetSize := big.NewInt(int64(len(pairingRequestCodeAlphabet)))
	var b strings.Builder
	b.Grow(pairingRequestCodeLength)
	for i := 0; i < pairingRequestCodeLength; i++ {
		n, err := rand.Int(rand.Reader, alphabetSize)
		if err != nil {
			return "", err
		}
		b.WriteByte(pairingRequestCodeAlphabet[n.Int64()])
	}
	return b.String(), nil
}

// generateRequestID mints an opaque, unguessable id naming one pairing
// request -- 16 random bytes, hex-encoded, distinct from the human-
// facing code above (this id is never shown, only carried in URLs).
func generateRequestID() (string, error) {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return hex.EncodeToString(buf), nil
}

// RequestPairing mints a pairing request for the popup-open discovery
// flow (goal 0379): a fresh numeric code and opaque request id, shown
// in BOTH the browser's popup and Mill's own incoming-request card for
// the human comparison step Accept/Deny resolves. Replaces any request
// still outstanding -- one live request at a time, the same single-
// live-code rule mintCode already follows for the typed path. Shares
// PairBrowser's rate-limit bucket (checkRateLimit, keyed by source) so
// a lockout from repeated bad pairing codes also blocks a flood of
// pairing REQUESTS from the same source.
//
// Exported for the bridge's HTTP handler, never for the frontend --
// same reasoning PairBrowser's own doc comment gives: a bound RPC
// reachable from the desktop webview has no business minting a request
// meant to arrive from a browser's popup over loopback HTTP.
//
//wails:ignore
func (s *RemoteAuthService) RequestPairing(label, source string) (PairingRequestInfo, error) {
	now := time.Now()

	s.mu.Lock()
	if allowed, _ := s.checkRateLimit(source, now); !allowed {
		s.mu.Unlock()
		return PairingRequestInfo{}, usererror.New(CodePairingLockedOut, "Too many wrong codes. Wait a minute and try again.")
	}
	s.mu.Unlock()

	code, err := generatePairingRequestCode()
	if err != nil {
		return PairingRequestInfo{}, fmt.Errorf("remoteauthsvc: generating pairing request code: %w", err)
	}
	id, err := generateRequestID()
	if err != nil {
		return PairingRequestInfo{}, fmt.Errorf("remoteauthsvc: generating pairing request id: %w", err)
	}
	expiresAt := now.Add(pairingRequestTTL)
	label = browserLabel(label)

	s.mu.Lock()
	s.pairRequest = &pairingRequest{
		id:        id,
		code:      code,
		label:     label,
		status:    pairingRequestStatusPending,
		expiresAt: expiresAt,
	}
	notif := s.notif
	s.mu.Unlock()

	if notif != nil {
		if _, err := notif.Publish(notification.Event{
			Type:      browserPairRequestEventType,
			Title:     label + " wants to pair",
			Body:      "Code " + code,
			DedupeKey: id,
			SourceRef: id,
			Targets:   browserPairRequestTargets,
		}); err != nil {
			s.logger.Warn("publish browser pair-request notification", "request", id, "error", err)
		}
	}

	return PairingRequestInfo{RequestID: id, Code: code, ExpiresAt: expiresAt}, nil
}

// PairingStatus answers a browser popup's poll: pending while
// unresolved, accepted once Accept fires in Mill, denied/expired
// otherwise. A stale or mismatched requestID reads exactly like
// "expired" -- never distinguishing the two, so a guess never learns
// whether an id ever existed, and a lapsed TTL is caught here too so a
// popup that polls right at the deadline still gets a fail-closed
// answer without a separate sweep.
//
// Exported for the bridge's HTTP handler, never for the frontend, same
// reasoning as RequestPairing above.
//
//wails:ignore
func (s *RemoteAuthService) PairingStatus(requestID string) PairingRequestStatus {
	s.mu.Lock()
	defer s.mu.Unlock()

	req := s.pairRequest
	if req == nil || req.id != requestID {
		return PairingRequestStatus{Status: pairingRequestStatusExpired}
	}
	if req.status == pairingRequestStatusPending && time.Now().After(req.expiresAt) {
		req.status = pairingRequestStatusExpired
	}
	switch req.status {
	case pairingRequestStatusAccepted:
		return PairingRequestStatus{Status: pairingRequestStatusAccepted, Token: req.token, DeviceID: req.deviceID, Label: req.label}
	case pairingRequestStatusDenied:
		return PairingRequestStatus{Status: pairingRequestStatusDenied}
	case pairingRequestStatusExpired:
		return PairingRequestStatus{Status: pairingRequestStatusExpired}
	default:
		return PairingRequestStatus{Status: pairingRequestStatusPending}
	}
}

// PendingPairingRequest is Settings > Connections > Browsers' own poll
// (goal 0379, no server push exists to tell it a request just arrived)
// -- the SAME code the popup shows, for the human comparison step
// Accept/Deny confirms. A zero-value RequestID means nothing is
// pending right now, including a request whose TTL just lapsed.
func (s *RemoteAuthService) PendingPairingRequest() PendingPairingRequest {
	s.mu.Lock()
	defer s.mu.Unlock()

	req := s.pairRequest
	if req == nil || req.status != pairingRequestStatusPending {
		return PendingPairingRequest{}
	}
	if time.Now().After(req.expiresAt) {
		req.status = pairingRequestStatusExpired
		return PendingPairingRequest{}
	}
	return PendingPairingRequest{RequestID: req.id, Code: req.code, Label: req.label, ExpiresAt: req.expiresAt}
}

// AcceptPairingRequest is the numeric-comparison trust decision itself
// (goal 0379): Settings > Connections > Browsers' Accept button,
// meant to be called only after a human has read the SAME code in both
// the popup and this card. Mints a browser pairing exactly like
// PairBrowser (mintDevice, KindBrowser), so a browser's post-pairing
// storage write is unchanged whichever path it arrived through.
// Rejects a stale/wrong/already-resolved id server-side -- Accept
// after expiry is refused, never silently minting a token for a
// request the popup has already given up on.
func (s *RemoteAuthService) AcceptPairingRequest(requestID string) (BrowserPairing, error) {
	s.mu.Lock()
	req := s.pairRequest
	if req == nil || req.id != requestID || req.status != pairingRequestStatusPending || time.Now().After(req.expiresAt) {
		s.mu.Unlock()
		return BrowserPairing{}, usererror.New(CodePairingRequestNotFound, "That request expired. Try again.")
	}
	token, err := s.mintDevice(req.label, "", KindBrowser)
	if err != nil {
		s.mu.Unlock()
		return BrowserPairing{}, err
	}
	minted := s.devices[len(s.devices)-1]
	req.status = pairingRequestStatusAccepted
	req.token = token
	req.deviceID = minted.ID
	s.mu.Unlock()

	s.logger.Info("browser bridge: browser paired", "device", minted.ID, "label", minted.Label)
	return BrowserPairing{Token: token, DeviceID: minted.ID, Label: minted.Label}, nil
}

// DenyPairingRequest is Settings > Connections > Browsers' Deny
// button: marks the pending request denied so a browser's next poll
// fails closed, without touching the paired-device list at all.
func (s *RemoteAuthService) DenyPairingRequest(requestID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	req := s.pairRequest
	if req == nil || req.id != requestID || req.status != pairingRequestStatusPending {
		return usererror.New(CodePairingRequestNotFound, "That request expired. Try again.")
	}
	req.status = pairingRequestStatusDenied
	return nil
}
