package configuresvc

import (
	"errors"
	"fmt"

	"github.com/alicoding/mill/internal/adapters/credential"
	"github.com/alicoding/mill/internal/domain/httprequest"
)

// resolveHTTPRequest's own keychain-fetch sub-steps -- split into their
// own file (goal 0203 S3) once extracting them out of resolveHTTPRequest
// itself (to pay its cognitive complexity back under this repo's own
// gate, gocognit @ 15) pushed configureservice_requestauth.go past the
// 500-line limit (scripts/check-loc.sh). Same *ConfigureService
// receiver, same file-per-concern organization that file's own header
// comment already establishes.

// resolveHTTPRequestSecret fetches id's AuthType secret from the OS
// keychain (skipped entirely for AuthNone -- there's nothing to fetch).
func (c *ConfigureService) resolveHTTPRequestSecret(id string, authType httprequest.AuthType, label string) (string, error) {
	if authType == httprequest.AuthNone {
		return "", nil
	}
	s, err := c.credentials.Get(id)
	if err != nil {
		// A missing keychain entry is a fix-it-in-Configure state, not a
		// system fault -- say so in the user's vocabulary (secrets never
		// travel with an exported/seeded request, so this is the
		// expected first-run state on a new device).
		if errors.Is(err, credential.ErrNotFound) {
			return "", fmt.Errorf(
				"the integration %q has no credential saved on this device -- open it in Configure and enter its token or secret", label)
		}
		return "", fmt.Errorf("request %q: %w", id, err)
	}
	return s, nil
}

// resolveHTTPRequestJOSEKey fetches id's JOSE response-decryption
// private key from its own, separately-keychained slot (skipped when
// JOSE decryption isn't configured).
func (c *ConfigureService) resolveHTTPRequestJOSEKey(id string, jose *httprequest.JOSEConfig, label string) (string, error) {
	if jose == nil || !jose.DecryptResponse {
		return "", nil
	}
	s, err := c.credentials.Get(joseKeychainID(id))
	if err != nil {
		if errors.Is(err, credential.ErrNotFound) {
			return "", fmt.Errorf(
				"the integration %q has no response-decryption key saved on this device -- open it in Configure and enter its private key", label)
		}
		return "", fmt.Errorf("request %q: JOSE private key: %w", id, err)
	}
	return s, nil
}
