package composition

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha1" //nolint:gosec // RFC 5849 §3.4.2 mandates HMAC-SHA1 as OAuth 1.0a's signature method -- not a Mill design choice, the actual standard.
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/alicoding/mill/internal/domain/connector"
)

// oauth1Secret is the JSON shape ConsumerSecret/TokenSecret get encoded
// into for storage in the connector's one keychain secret slot
// (ADR-0015 §3 -- Mill doesn't have a multi-secret-per-connector
// storage model, so a scheme needing two secret-shaped values encodes
// them into the one string credential.Set/Get already round-trips).
type oauth1Secret struct {
	ConsumerSecret string `json:"consumerSecret"`
	TokenSecret    string `json:"tokenSecret"`
}

// decodeOAuth1Secret is lenient by design: a secret that isn't the
// expected JSON shape (e.g. a bare string, from before this existed or
// from a user who only has a consumer secret and no token secret) is
// treated as the consumer secret alone -- 2-legged OAuth 1.0a (no
// token) is a real, valid RFC 5849 use, and this keeps that path
// working without requiring the JSON shape for the common case.
func decodeOAuth1Secret(raw string) (consumerSecret, tokenSecret string) {
	var s oauth1Secret
	if err := json.Unmarshal([]byte(raw), &s); err == nil && s.ConsumerSecret != "" {
		return s.ConsumerSecret, s.TokenSecret
	}
	return raw, ""
}

// EncodeOAuth1Secret is the inverse of decodeOAuth1Secret -- exported
// so ConfigureService can build the one stored string from a Connector
// form's two separate secret fields before calling credential.Set.
func EncodeOAuth1Secret(consumerSecret, tokenSecret string) string {
	b, _ := json.Marshal(oauth1Secret{ConsumerSecret: consumerSecret, TokenSecret: tokenSecret})
	return string(b)
}

// oauth1Encode is RFC 5849 §3.6's percent-encoding -- RFC 3986's
// unreserved characters (A-Z a-z 0-9 - . _ ~) pass through, everything
// else is %-escaped with uppercase hex. Deliberately not net/url's
// QueryEscape (encodes space as "+", not "%20", and doesn't match RFC
// 3986 exactly) -- OAuth 1.0a's signature is wrong if the encoding
// doesn't match the spec exactly, so this can't reuse a general-purpose
// URL encoder that solves a slightly different problem.
func oauth1Encode(s string) string {
	var b strings.Builder
	for i := 0; i < len(s); i++ {
		c := s[i]
		if (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '-' || c == '.' || c == '_' || c == '~' {
			b.WriteByte(c)
		} else {
			fmt.Fprintf(&b, "%%%02X", c)
		}
	}
	return b.String()
}

func oauth1Nonce() string {
	buf := make([]byte, 16)
	_, _ = rand.Read(buf)
	return hex.EncodeToString(buf)
}

// AuthOAuth1 implements RFC 5849's HMAC-SHA1 signature method (ADR-0015's
// research checkpoint: the one well-specified OAuth-1.0-family option,
// covering what the reference-platform research called "OAuth 1.0
// HMAC"). Signs method+URL+normalized-params per §3.4.1, sets the
// resulting credentials as an "Authorization: OAuth ..." header per
// §3.5.1 (the header transport, the most common of RFC 5849's three).
func init() {
	RegisterAuthStrategy(connector.AuthOAuth1, func(rc ResolvedConnector, method, path string, headers map[string]string, query url.Values, body string) error {
		var cfg connector.OAuth1Config
		if rc.Auth != nil && rc.Auth.OAuth1 != nil {
			cfg = *rc.Auth.OAuth1
		}
		consumerSecret, tokenSecret := decodeOAuth1Secret(rc.Secret)

		baseURL := strings.TrimRight(rc.BaseURL, "/") + path
		if idx := strings.Index(baseURL, "?"); idx >= 0 {
			baseURL = baseURL[:idx]
		}

		nonce := oauth1Nonce()
		timestamp := strconv.FormatInt(time.Now().Unix(), 10)

		params := url.Values{}
		for k, v := range query {
			params[k] = v
		}
		params.Set("oauth_consumer_key", cfg.ConsumerKey)
		params.Set("oauth_nonce", nonce)
		params.Set("oauth_signature_method", "HMAC-SHA1")
		params.Set("oauth_timestamp", timestamp)
		params.Set("oauth_version", "1.0")
		if cfg.Token != "" {
			params.Set("oauth_token", cfg.Token)
		}

		keys := make([]string, 0, len(params))
		for k := range params {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		parts := make([]string, 0, len(params))
		for _, k := range keys {
			for _, v := range params[k] {
				parts = append(parts, oauth1Encode(k)+"="+oauth1Encode(v))
			}
		}
		normalizedParams := strings.Join(parts, "&")

		baseString := strings.ToUpper(method) + "&" + oauth1Encode(baseURL) + "&" + oauth1Encode(normalizedParams)
		signingKey := oauth1Encode(consumerSecret) + "&" + oauth1Encode(tokenSecret)

		mac := hmac.New(sha1.New, []byte(signingKey))
		_, _ = mac.Write([]byte(baseString))
		signature := base64.StdEncoding.EncodeToString(mac.Sum(nil))

		authParams := []string{
			`oauth_consumer_key="` + oauth1Encode(cfg.ConsumerKey) + `"`,
			`oauth_nonce="` + oauth1Encode(nonce) + `"`,
			`oauth_signature="` + oauth1Encode(signature) + `"`,
			`oauth_signature_method="HMAC-SHA1"`,
			`oauth_timestamp="` + timestamp + `"`,
			`oauth_version="1.0"`,
		}
		if cfg.Token != "" {
			authParams = append(authParams, `oauth_token="`+oauth1Encode(cfg.Token)+`"`)
		}
		sort.Strings(authParams)
		headers["Authorization"] = "OAuth " + strings.Join(authParams, ", ")
		return nil
	})
}
