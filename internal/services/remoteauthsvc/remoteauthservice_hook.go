package remoteauthsvc

import (
	"strings"
	"time"
)

// KindHook is the third thing that can hold a Mill credential: a
// headless hook token for an external tool (an agent's hook config, a
// script) that POSTs events to the bridge's hook route. Unlike a
// browser or device there is no pairing exchange -- the token is
// minted on demand from Settings and copied into the tool's own config
// by hand, so the only ceremony is showing it exactly once. The kind
// check in validateToken keeps a hook token from ever serving as a
// browser bridge or device credential, and vice versa.
const KindHook = "hook"

// hookLabelFallback names a hook token minted without a label, so a
// Settings row is never blank.
const hookLabelFallback = "Webhook"

// HookToken is what Settings receives when a hook credential is
// minted: the bearer token to paste into the tool's hook config, and
// the id/label Settings shows for it. The token is returned exactly
// once and never retrievable again -- only its salted hash is kept,
// same storage posture as every other paired credential.
type HookToken struct {
	Token    string `json:"token"`
	DeviceID string `json:"deviceId"`
	Label    string `json:"label"`
}

// ListHooks returns every live hook token's read model, same order and
// shape as ListBrowsers -- hook tokens appear in their own Settings
// section, never mixed into the device or browser lists.
func (s *RemoteAuthService) ListHooks() []DeviceInfo {
	return s.listOfKind(KindHook)
}

// MintHookToken pairs a new hook credential, returning its raw token
// exactly once for the user to copy into a tool's hook config. There
// is no pairing code or exchange: the consumer is a shell command in a
// config file, so the credential itself is the whole ceremony. Minting
// more than one is legitimate (one per tool, or a rotation) -- each is
// its own Settings row with its own revoke, like a paired browser.
func (s *RemoteAuthService) MintHookToken(label string) (HookToken, error) {
	trimmed := strings.TrimSpace(label)
	if trimmed == "" {
		trimmed = hookLabelFallback
	}
	if len(trimmed) > deviceLabelMaxLen {
		trimmed = trimmed[:deviceLabelMaxLen]
	}

	s.mu.Lock()
	token, err := s.mintDevice(trimmed, "", KindHook)
	if err != nil {
		s.mu.Unlock()
		return HookToken{}, err
	}
	minted := s.devices[len(s.devices)-1]
	s.mu.Unlock()

	s.logger.Info("hook token minted", "device", minted.ID, "label", minted.Label)
	return HookToken{Token: token, DeviceID: minted.ID, Label: minted.Label}, nil
}

// ValidateHookToken reports whether token names a live hook credential,
// refreshing its last-seen stamp. The kind check in validateToken
// refuses a browser or device token here even though it is a valid
// credential on its own surface.
//
// Exported for the bridge's HTTP handler, never for the frontend.
//
//wails:ignore
func (s *RemoteAuthService) ValidateHookToken(token string) (DeviceInfo, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.validateToken(token, "", KindHook, time.Now())
}
