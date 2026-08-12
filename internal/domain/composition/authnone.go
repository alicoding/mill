package composition

import (
	"net/url"

	"github.com/alicoding/mill/internal/domain/httprequest"
)

// AuthNone adds nothing to the request -- migrated from the original
// AuthHeader switch's default case (ADR-0015), byte-identical behavior.
func init() {
	RegisterAuthStrategy(httprequest.AuthNone, func(_ ResolvedHTTPRequest, _, _ string, _ map[string]string, _ url.Values, _ string) error {
		return nil
	})
}
