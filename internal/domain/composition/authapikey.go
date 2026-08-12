package composition

import (
	"net/url"

	"github.com/alicoding/mill/internal/domain/httprequest"
)

// AuthAPIKey sets X-Api-Key -- migrated verbatim from the original
// AuthHeader switch (ADR-0015), byte-identical behavior.
func init() {
	RegisterAuthStrategy(httprequest.AuthAPIKey, func(rc ResolvedHTTPRequest, _, _ string, headers map[string]string, _ url.Values, _ string) error {
		headers["X-Api-Key"] = rc.Secret
		return nil
	})
}
