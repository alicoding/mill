package composition

import (
	"net/url"

	"github.com/alicoding/mill/internal/domain/connector"
)

// AuthBearer sets "Authorization: Bearer <secret>" -- migrated verbatim
// from the original AuthHeader switch (ADR-0015), byte-identical
// behavior.
func init() {
	RegisterAuthStrategy(connector.AuthBearer, func(rc ResolvedConnector, method, path string, headers map[string]string, query url.Values, body string) error {
		headers["Authorization"] = "Bearer " + rc.Secret
		return nil
	})
}
