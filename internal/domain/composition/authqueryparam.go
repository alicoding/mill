package composition

import (
	"net/url"

	"github.com/alicoding/mill/internal/domain/httprequest"
)

// AuthQueryParam places the resolved secret in the URL's query string
// (as "apikey=<secret>") instead of a header -- the query-string
// counterpart to AuthAPIKey's header, same "a common default for the
// scheme" reasoning the original AuthHeader switch already used for its
// own header names (§3.2's incremental-extensibility principle: a
// vendor needing a different query-param name is real future work, not
// solved speculatively here).
func init() {
	RegisterAuthStrategy(httprequest.AuthQueryParam, func(rc ResolvedHTTPRequest, _, _ string, _ map[string]string, query url.Values, _ string) error {
		query.Set("apikey", rc.Secret)
		return nil
	})
}
