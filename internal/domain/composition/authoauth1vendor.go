package composition

import (
	"fmt"
	"net/url"

	"github.com/alicoding/mill/internal/domain/httprequest"
)

// AuthOAuth1Vendor is a real, registered AuthType whose strategy is a
// deliberate stub (ADR-0015's research checkpoint): the reference-
// platform review that surfaced this option never confirmed its actual
// vendor-specific quirk on top of standard OAuth 1.0a (a different
// header name, parameter set, or base-string convention are all
// plausible and none confirmed) -- guessing one risks shipping
// something that silently doesn't match the real vendor's
// expectations, worse than an honest, named "not yet implemented."
// Registering it here (rather than leaving it out of the AuthType enum
// entirely) is itself the proof this pass set out to deliver: adding a
// new AuthType is a pure addition, zero changes to any other strategy
// file, whether or not that type's own behavior is fully built yet.
func init() {
	RegisterAuthStrategy(httprequest.AuthOAuth1Vendor, func(rc ResolvedHTTPRequest, method, path string, headers map[string]string, query url.Values, body string) error {
		return fmt.Errorf("the vendor-specific OAuth 1.0a variant is not yet implemented -- its exact signing convention was never confirmed (docs/adr/0015); use AuthOAuth1 (standard RFC 5849) if that fits, or file the real requirement")
	})
}
