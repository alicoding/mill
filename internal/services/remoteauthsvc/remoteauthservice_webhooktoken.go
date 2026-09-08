package remoteauthsvc

import (
	"strings"
	"time"
)

// KindWebhookToken is the third thing that can hold a Mill credential:
// a headless bearer token for any tool or service that can send an
// HTTP request, posted to the bridge's webhook route. Unlike a browser
// or device there is no pairing exchange -- the token is minted on
// demand from Settings and copied into the tool's own configuration by
// hand, so the only ceremony is showing it exactly once. The kind
// check in validateToken keeps a webhook token from ever serving as a
// browser bridge or device credential, and vice versa.
//
// Persisted records written before goal 0387 carry the retired value
// "hook" -- loadDevices migrates them to this value at load, so an
// existing token keeps validating with no re-mint required.
const KindWebhookToken = "webhook-token"

// webhookTokenLabelFallback names a webhook token minted without a
// label, so a Settings row is never blank.
const webhookTokenLabelFallback = "Webhook"

// WebhookToken is what Settings receives when a webhook credential is
// minted: the bearer token to paste into the tool's configuration, and
// the id/label Settings shows for it. The token is returned exactly
// once and never retrievable again -- only its salted hash is kept,
// same storage posture as every other paired credential.
type WebhookToken struct {
	Token    string `json:"token"`
	DeviceID string `json:"deviceId"`
	Label    string `json:"label"`
}

// ListWebhookTokens returns every live webhook token's read model,
// same order and shape as ListBrowsers -- webhook tokens appear in
// their own Settings section, never mixed into the device or browser
// lists.
func (s *RemoteAuthService) ListWebhookTokens() []DeviceInfo {
	return s.listOfKind(KindWebhookToken)
}

// MintWebhookToken pairs a new webhook credential, returning its raw
// token exactly once for the user to copy into a tool's configuration.
// There is no pairing code or exchange: the consumer is a shell
// command or an HTTP client in a config file, so the credential itself
// is the whole ceremony. Minting more than one is legitimate (one per
// tool, or a rotation) -- each is its own Settings row with its own
// revoke, like a paired browser.
func (s *RemoteAuthService) MintWebhookToken(label string) (WebhookToken, error) {
	trimmed := strings.TrimSpace(label)
	if trimmed == "" {
		trimmed = webhookTokenLabelFallback
	}
	if len(trimmed) > deviceLabelMaxLen {
		trimmed = trimmed[:deviceLabelMaxLen]
	}

	s.mu.Lock()
	token, err := s.mintDevice(trimmed, "", KindWebhookToken)
	if err != nil {
		s.mu.Unlock()
		return WebhookToken{}, err
	}
	minted := s.devices[len(s.devices)-1]
	s.mu.Unlock()

	s.logger.Info("webhook token minted", "device", minted.ID, "label", minted.Label)
	return WebhookToken{Token: token, DeviceID: minted.ID, Label: minted.Label}, nil
}

// ValidateWebhookToken reports whether token names a live webhook
// credential, refreshing its last-seen stamp. The kind check in
// validateToken refuses a browser or device token here even though it
// is a valid credential on its own surface.
//
// Exported for the bridge's HTTP handler, never for the frontend.
//
//wails:ignore
func (s *RemoteAuthService) ValidateWebhookToken(token string) (DeviceInfo, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.validateToken(token, "", KindWebhookToken, time.Now())
}
