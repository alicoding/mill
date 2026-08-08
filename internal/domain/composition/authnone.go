package composition

import (
	"net/url"

	"github.com/alicoding/mill/internal/domain/connector"
)

// AuthNone adds nothing to the request -- migrated from the original
// AuthHeader switch's default case (ADR-0015), byte-identical behavior.
func init() {
	RegisterAuthStrategy(connector.AuthNone, func(rc ResolvedConnector, method, path string, headers map[string]string, query url.Values, body string) error {
		return nil
	})
}
