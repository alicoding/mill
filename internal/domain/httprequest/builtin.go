package httprequest

// BuiltIn ships one seeded, working example HTTPRequest per real
// implemented AuthType (docs/SPEC.md §4's Update) -- the same standing
// practice CompositionService.restore() already established for
// Workflows (composition.BuiltInWorkflows): every capability that
// lands ships a real, runnable example a user can inspect, clone, or
// delete, not just a description in a doc. Every example here targets
// a real, stable, publicly-reachable third party (httpbin.org,
// postman-echo.com) -- verified live, not assumed, before being
// hardcoded (see docs/adr/0015-connector-auth-strategy.md's Update).
//
// AuthOAuth1Vendor and AuthMTLS are deliberately NOT given an example:
// both are stub strategies (ADR-0015) that always return "not yet
// implemented" -- an example that's guaranteed to fail isn't a working
// example, it's noise. AuthOAuth2 gets an example with a real,
// verified token URL but no pre-filled credentials -- OAuth 2.0
// fundamentally can't be demonstrated without a registered app, and
// Mill's own repo will never carry a real client secret (that's a
// leaked-credential risk, not a convenience). Its Description says so
// explicitly rather than silently shipping a request that fails with
// no explanation.
//
// HTTPRequest IDs are exported constants (not local string literals) so
// the one place that also needs to know them -- the demo-secret
// seeding in configureservice_builtin.go (package main, since
// HTTPRequest itself never carries a secret field) -- can't drift from
// these via a typo.
const (
	ExampleNoneID       = "example-none-httpbin"
	ExampleAPIKeyID     = "example-apikey-httpbin"
	ExampleBearerID     = "example-bearer-httpbin"
	ExampleHMACID       = "example-hmac-httpbin"
	ExampleOAuth1ID     = "example-oauth1-postman-echo"
	ExampleOAuth2ID     = "example-oauth2-spotify"
	ExampleQueryParamID = "example-queryparam-httpbin"
)

func openAPISpecFor(title, path string) string {
	return `{"openapi":"3.0.3","info":{"title":"` + title + `","version":"1.0.0"},` +
		`"paths":{"` + path + `":{"get":{"summary":"` + title + `","responses":{"200":{"description":"OK"}}}}}}`
}

// BuiltIn returns the seeded example requests -- pure config, no
// secrets (HTTPRequest never carries one, by design). Whoever owns
// storage (ConfigureService) is responsible for also seeding each
// example's demo secret into the OS keychain on first install.
func BuiltIn() []HTTPRequest {
	return []HTTPRequest{
		{
			ID: ExampleNoneID, Label: "Example: No auth (httpbin.org)",
			Description: "Demonstrates AuthType none against a real, stable public test service " +
				"(httpbin.org) -- no credentials involved, always works.",
			BaseURL: "https://httpbin.org", AuthType: AuthNone, Method: "GET",
			OpenAPISpec: openAPISpecFor("httpbin GET", "/get"),
			BuiltIn:     true,
		},
		{
			ID: ExampleAPIKeyID, Label: "Example: API key header (httpbin.org)",
			Description: "Sends X-Api-Key as a header. httpbin.org/headers reliably echoes back " +
				"whatever it received, so you can see the header arrived correctly -- it does not " +
				"validate the key's value (httpbin has no concept of a 'correct' key), so this is a " +
				"self-consistency check, not third-party-verified auth.",
			BaseURL: "https://httpbin.org", AuthType: AuthAPIKey, Method: "GET",
			OpenAPISpec: openAPISpecFor("httpbin headers echo", "/headers"),
			BuiltIn:     true,
		},
		{
			ID: ExampleBearerID, Label: "Example: Bearer token (httpbin.org)",
			Description: "Sends Authorization: Bearer <token> against httpbin.org/bearer, which " +
				"genuinely validates the request server-side: 401 with no token, 200 + " +
				"{\"authenticated\":true} with one -- real, independently-verified round trip, " +
				"confirmed live before this was seeded.",
			BaseURL: "https://httpbin.org", AuthType: AuthBearer, Method: "GET",
			OpenAPISpec: openAPISpecFor("httpbin bearer check", "/bearer"),
			BuiltIn:     true,
		},
		{
			ID: ExampleHMACID, Label: "Example: HMAC signature (httpbin.org)",
			Description: "Signs method+path+timestamp+body with HMAC-SHA256, sent as " +
				"X-Signature/X-Timestamp headers (Mill's own stated default, ADR-0015 -- no " +
				"universal HMAC convention exists to validate against). httpbin.org/headers echoes " +
				"the signed headers back so you can see them, but doesn't verify the signature -- " +
				"self-consistency check only, same caveat as the API-key example above.",
			BaseURL: "https://httpbin.org", AuthType: AuthHMAC, Method: "GET",
			OpenAPISpec: openAPISpecFor("httpbin headers echo (HMAC)", "/headers"),
			BuiltIn:     true,
		},
		{
			ID: ExampleOAuth1ID, Label: "Example: OAuth 1.0a (postman-echo.com)",
			Description: "Real RFC 5849 HMAC-SHA1 request signing, using Postman's own published " +
				"test credentials against their own signature-verifying endpoint " +
				"(postman-echo.com/oauth1) -- independently confirmed live: the server itself " +
				"returned {\"status\":\"pass\",\"message\":\"OAuth-1.0a signature verification was " +
				"successful\"} before this was seeded, not just self-consistent with Mill's own tests.",
			BaseURL: "https://postman-echo.com", AuthType: AuthOAuth1, Method: "GET",
			Auth:        &AuthConfig{OAuth1: &OAuth1Config{ConsumerKey: "RKCGzna7bv9YD57c"}},
			OpenAPISpec: openAPISpecFor("Postman Echo OAuth1", "/oauth1"),
			BuiltIn:     true,
		},
		{
			ID: ExampleOAuth2ID, Label: "Example: OAuth 2.0 client credentials (Spotify Web API)",
			Description: "Shows the real client_credentials shape -- a genuine, currently-documented " +
				"token URL (accounts.spotify.com/api/token) -- but ships with no Client ID/Secret: " +
				"OAuth 2.0 fundamentally can't be demonstrated without a registered app, and Mill's " +
				"own repo will never carry a real client secret. Register a free Spotify developer " +
				"app and fill in the Client ID/Secret yourself to make this one actually run.",
			BaseURL: "https://api.spotify.com/v1", AuthType: AuthOAuth2, Method: "GET",
			Auth: &AuthConfig{OAuth2: &OAuth2Config{
				GrantType: "client_credentials", TokenURL: "https://accounts.spotify.com/api/token",
			}},
			OpenAPISpec: openAPISpecFor("Spotify Web API (bring your own app)", "/browse/new-releases"),
			BuiltIn:     true,
		},
		{
			ID: ExampleQueryParamID, Label: "Example: Query-param API key (httpbin.org)",
			Description: "Sends ?apikey=<secret> in the URL's query string against httpbin.org/get, " +
				"which echoes back the query it received -- same self-consistency-only caveat as the " +
				"header-based API-key example (httpbin doesn't validate the value).",
			BaseURL: "https://httpbin.org", AuthType: AuthQueryParam, Method: "GET",
			OpenAPISpec: openAPISpecFor("httpbin query echo", "/get"),
			BuiltIn:     true,
		},
	}
}
