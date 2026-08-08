package composition

import (
	"fmt"
	"net/url"

	"github.com/alicoding/mill/internal/adapters/oauth2client"
	"github.com/alicoding/mill/internal/domain/httprequest"
)

// AuthOAuth2 implements the client_credentials grant (ADR-0015) via
// internal/adapters/oauth2client (golang.org/x/oauth2/clientcredentials
// underneath -- already an indirect dependency before this pass,
// promoted to direct). The token-source cache itself lives in that
// adapter, not here -- matches internal/adapters/httpconnector's own
// shape (a commodity client needing package-level state belongs in an
// adapter, .claude/rules/backend.md's domain-purity rule). Only the
// standard RFC 6749 §4.4.2 form-urlencoded token-request content type
// is actually sent (the library's own fixed behavior) -- Config.
// ContentType is stored for future extensibility but not yet wired to
// anything, an honest gap rather than a silently-ignored setting
// pretending to work.
func init() {
	RegisterAuthStrategy(httprequest.AuthOAuth2, func(rc ResolvedHTTPRequest, method, path string, headers map[string]string, query url.Values, body string) error {
		var cfg httprequest.OAuth2Config
		if rc.Auth != nil && rc.Auth.OAuth2 != nil {
			cfg = *rc.Auth.OAuth2
		}
		if cfg.GrantType != "" && cfg.GrantType != "client_credentials" {
			return fmt.Errorf("oauth2: grant type %q is not supported (only client_credentials is built, docs/adr/0015)", cfg.GrantType)
		}

		tokenType, accessToken, err := oauth2client.Token(cfg.ClientID, rc.Secret, cfg.TokenURL, cfg.Scope)
		if err != nil {
			return fmt.Errorf("oauth2: %w", err)
		}
		headers["Authorization"] = tokenType + " " + accessToken
		return nil
	})
}
