package composition

import (
	"fmt"
	"net/url"

	"github.com/alicoding/mill/internal/domain/connector"
)

// AuthMTLS is a real, registered AuthType whose strategy is a
// deliberate stub -- explicitly out of scope for implementation this
// goal (decided directly with the user: "no need for mTLS yet but plan
// for it to be extend easily"). Registering it here, with zero changes
// to any other strategy file, is the actual proof the seam is
// extensible; a real client-cert implementation (crypto/tls.Config.
// Certificates + software.sslmate.com/src/go-pkcs12 for P12 decoding,
// per docs/SPEC.md §4.1's research) is real future work.
func init() {
	RegisterAuthStrategy(connector.AuthMTLS, func(rc ResolvedConnector, method, path string, headers map[string]string, query url.Values, body string) error {
		return fmt.Errorf("mTLS is not yet implemented (docs/adr/0015) -- deliberately deferred, not a bug")
	})
}
