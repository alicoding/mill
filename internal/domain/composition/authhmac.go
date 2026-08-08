package composition

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"net/url"
	"strconv"
	"time"

	"github.com/alicoding/mill/internal/domain/httprequest"
)

// AuthHMAC signs {method}\n{path}\n{timestamp}\n{body} with HMAC-SHA256
// using the request's keychain secret as the key, sent as
// X-Signature (or rc.Auth.HMAC.HeaderName if set) + X-Timestamp
// headers. Mill's own defensible default, stated as one (not a claimed
// universal standard) -- ADR-0015's research checkpoint confirmed
// there is no single, converged HMAC-auth convention across real APIs
// to adopt instead. A real vendor needing a different convention
// (different header names, a different signed-payload shape) is real
// future work, §3.2's own "extend when a real request needs it"
// principle applied here the same as everywhere else.
func init() {
	RegisterAuthStrategy(httprequest.AuthHMAC, func(rc ResolvedHTTPRequest, method, path string, headers map[string]string, query url.Values, body string) error {
		headerName := "X-Signature"
		if rc.Auth != nil && rc.Auth.HMAC != nil && rc.Auth.HMAC.HeaderName != "" {
			headerName = rc.Auth.HMAC.HeaderName
		}
		timestamp := strconv.FormatInt(time.Now().Unix(), 10)
		payload := method + "\n" + path + "\n" + timestamp + "\n" + body

		mac := hmac.New(sha256.New, []byte(rc.Secret))
		_, _ = mac.Write([]byte(payload))
		signature := base64.StdEncoding.EncodeToString(mac.Sum(nil))

		headers[headerName] = signature
		headers["X-Timestamp"] = timestamp
		return nil
	})
}
