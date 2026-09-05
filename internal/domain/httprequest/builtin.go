package httprequest

import "github.com/alicoding/mill/internal/domain/seedorigin"

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
	// ExampleEnvironmentID (goal 0306 S5) is the one seeded request
	// whose URL is written with a variable instead of a host. It is
	// deliberately its own request rather than a change to
	// ExampleNoneID: three seeds share that one, and only the workflow
	// below selects an environment, so templating the shared request
	// would make the other two unrunnable.
	ExampleEnvironmentID = "example-environment-httpbin"
	// ExampleConfluencePageReadID and ExampleJiraSearchID (goal 0111)
	// demonstrate calling a self-hosted Atlassian Data Center instance
	// over a user-supplied Personal Access Token. Both are
	// bring-your-own-host: BaseURL ships as the RFC 2606 reserved
	// "example.invalid" (guaranteed to never resolve, unlike
	// "example.com" -- an unconfigured run fails with an obvious DNS
	// error instead of quietly succeeding against someone else's real
	// site), same placeholder-not-empty shape the seeded filesystem-watch
	// example already uses for its own default path. The credential slot
	// ships unfilled, same shape ExampleOAuth2ID already established for
	// a capability that can't be demonstrated without the user's own
	// registration.
	ExampleConfluencePageReadID = "example-confluence-page-read"
	ExampleJiraSearchID         = "example-jira-search"
)

// One-URL model (composition.JoinRequestURL): every seed's BaseURL is
// the COMPLETE endpoint URL and its single operation's path is "/",
// which appends nothing at execution -- one URL, one place, matching
// the request form's own single URL field.
func openAPISpecFor(title string) string {
	return `{"openapi":"3.0.3","info":{"title":"` + title + `","version":"1.0.0"},` +
		`"paths":{"/":{"get":{"summary":"` + title + `","responses":{"200":{"description":"OK"}}}}}}`
}

// Two seeds carry a real *typed* schema (input parameters + typed
// response fields), not just a bare 200, so the Test tab demonstrates
// the full typed round trip against a live public service out of the
// box (docs/SPEC.md §4's Update -- prompted directly: "I want to see a
// real example ... getting an actual typed request and response in
// action in the Test feature"). Both response shapes were verified
// against the real endpoints' actual JSON before being hardcoded, not
// assumed.

// typedEchoSpec: httpbin.org/get echoes the query it received --
// input: one query parameter (q); outputs: url/origin flat, plus the
// echoed q extracted from the nested args object via x-mill-path
// (ADR-0011's nested-response extraction, demonstrated on real data).
const typedEchoSpec = `{"openapi":"3.0.3","info":{"title":"httpbin typed echo","version":"1.0.0"},"paths":{"/":{"get":{` +
	`"summary":"Echo query with typed response",` +
	`"parameters":[{"name":"q","in":"query","required":false,"schema":{"type":"string","description":"Any value; httpbin echoes it back in args.q"}}],` +
	`"responses":{"200":{"description":"OK","content":{"application/json":{"schema":{"type":"object","properties":{` +
	`"url":{"type":"string","description":"The full URL httpbin received"},` +
	`"origin":{"type":"string","description":"Caller's public IP as httpbin saw it"},` +
	`"echoedQ":{"type":"string","x-mill-path":"args.q","description":"The q parameter echoed back, read from the nested args object"}` +
	`}}}}}}}}}}`

// typedBearerSpec: httpbin.org/bearer genuinely validates the
// Authorization header server-side and returns
// {"authenticated": bool, "token": string} -- typed here so the
// declared response fields line up 1:1 with the real JSON a test run
// receives.
const typedBearerSpec = `{"openapi":"3.0.3","info":{"title":"httpbin bearer check","version":"1.0.0"},"paths":{"/":{"get":{` +
	`"summary":"Bearer-validated call with typed response",` +
	`"responses":{"200":{"description":"OK","content":{"application/json":{"schema":{"type":"object","properties":{` +
	`"authenticated":{"type":"boolean","description":"True when the Bearer token was accepted"},` +
	`"token":{"type":"string","description":"The token httpbin received"}` +
	`}}}}}}}}}}`

// confluencePageReadSpec declares Confluence's real content-read
// endpoint (GET /rest/api/content/{contentId}?expand=body.export_view,
// Confluence Server/Data Center's own documented REST shape) as one
// literal operation path -- the legacy per-operation-path model (not
// the one-URL model the httpbin/postman examples above use), since
// this example's BaseURL is a placeholder host: a real user's own
// on-prem host replaces it and joins in front of this path at call
// time (JoinRequestURL). expand=body.export_view is a fixed part of
// the call (always want rendered HTML), so it's baked into the path
// literal rather than a bindable parameter; contentId is the one real
// per-run input, declared as a path parameter.
const confluencePageReadSpec = `{"openapi":"3.0.3","info":{"title":"Confluence page read (PAT)","version":"1.0.0"},` +
	`"paths":{"/rest/api/content/{contentId}?expand=body.export_view":{"get":{` +
	`"summary":"Read a Confluence page as rendered HTML",` +
	`"parameters":[{"name":"contentId","in":"path","required":true,"schema":{"type":"string","description":"The Confluence content (page) ID"}}],` +
	`"responses":{"200":{"description":"OK"}}}}}}`

// jiraSearchSpec declares Jira's real JQL search endpoint (GET
// /rest/api/2/search?jql={jql}&fields=summary,status,assignee&maxResults=50,
// Jira Server/Data Center's own documented REST shape) the same way:
// fields/maxResults are fixed parts of the call, jql is the one bound
// input.
const jiraSearchSpec = `{"openapi":"3.0.3","info":{"title":"Jira search (PAT)","version":"1.0.0"},` +
	`"paths":{"/rest/api/2/search?jql={jql}&fields=summary,status,assignee&maxResults=50":{"get":{` +
	`"summary":"Search Jira issues with a JQL query",` +
	`"parameters":[{"name":"jql","in":"path","required":true,"schema":{"type":"string","description":"The JQL query string"}}],` +
	`"responses":{"200":{"description":"OK"}}}}}}`

// BuiltIn returns the seeded example requests -- pure config, no
// secrets (HTTPRequest never carries one, by design). Whoever owns
// storage (ConfigureService) is responsible for also seeding each
// example's demo secret into the OS keychain on first install.
func BuiltIn() []HTTPRequest {
	return []HTTPRequest{
		{
			ID: ExampleNoneID, Label: "Example: No auth (httpbin.org)",
			Description: "Demonstrates AuthType none against a real, stable public test service " +
				"(httpbin.org). No credentials involved, always works.",
			BaseURL: "https://httpbin.org/get", AuthType: AuthNone, Method: "GET",
			OpenAPISpec: typedEchoSpec,
			BuiltIn:     true,
			Seed:        seedorigin.Stamp(2),
		},
		{
			ID: ExampleEnvironmentID, Label: "Example: Environment variable in the URL",
			Description: "The URL names {{API_BASE}} instead of a host, so the same request " +
				"reaches a different service depending on which environment the run selects. " +
				"The seeded Sandbox environment sets API_BASE to a public test service; the " +
				"seeded Production one sets it to an address that does not answer, so running " +
				"against it is a decision rather than an accident.",
			BaseURL: "{{API_BASE}}/get", AuthType: AuthNone, Method: "GET",
			OpenAPISpec: openAPISpecFor("environment variable echo"),
			BuiltIn:     true,
			Seed:        seedorigin.Stamp(1),
		},
		{
			ID: ExampleAPIKeyID, Label: "Example: API key header (httpbin.org)",
			Description: "Sends X-Api-Key as a header. httpbin.org/headers reliably echoes back " +
				"whatever it received, so you can see the header arrived correctly. It does not " +
				"validate the key's value (httpbin has no concept of a 'correct' key), so this is a " +
				"self-consistency check, not third-party-verified auth.",
			BaseURL: "https://httpbin.org/headers", AuthType: AuthAPIKey, Method: "GET",
			OpenAPISpec: openAPISpecFor("httpbin headers echo"),
			BuiltIn:     true,
			Seed:        seedorigin.Stamp(2),
		},
		{
			ID: ExampleBearerID, Label: "Example: Bearer token (httpbin.org)",
			Description: "Sends Authorization: Bearer <token> against httpbin.org/bearer, which " +
				"genuinely validates the request server-side: 401 with no token, 200 + " +
				"{\"authenticated\":true} with one.",
			BaseURL: "https://httpbin.org/bearer", AuthType: AuthBearer, Method: "GET",
			OpenAPISpec: typedBearerSpec,
			BuiltIn:     true,
			Seed:        seedorigin.Stamp(2),
		},
		{
			ID: ExampleHMACID, Label: "Example: HMAC signature (httpbin.org)",
			Description: "Signs method+path+timestamp+body with HMAC-SHA256, sent as " +
				"X-Signature/X-Timestamp headers (Mill's own stated default). httpbin.org/headers " +
				"echoes the signed headers back so you can see them, but doesn't verify the " +
				"signature. This is a self-consistency check only, same caveat as the API-key " +
				"example above.",
			BaseURL: "https://httpbin.org/headers", AuthType: AuthHMAC, Method: "GET",
			OpenAPISpec: openAPISpecFor("httpbin headers echo (HMAC)"),
			BuiltIn:     true,
			Seed:        seedorigin.Stamp(3),
		},
		{
			ID: ExampleOAuth1ID, Label: "Example: OAuth 1.0a (postman-echo.com)",
			Description: "Real RFC 5849 HMAC-SHA1 request signing, using Postman's own published " +
				"test credentials against their own signature-verifying endpoint " +
				"(postman-echo.com/oauth1).",
			BaseURL: "https://postman-echo.com/oauth1", AuthType: AuthOAuth1, Method: "GET",
			Auth:        &AuthConfig{OAuth1: &OAuth1Config{ConsumerKey: "RKCGzna7bv9YD57c"}},
			OpenAPISpec: openAPISpecFor("Postman Echo OAuth1"),
			BuiltIn:     true,
			Seed:        seedorigin.Stamp(2),
		},
		{
			ID: ExampleOAuth2ID, Label: "Example: OAuth 2.0 client credentials (Spotify Web API)",
			Description: "Shows the real client_credentials shape against a genuine, currently-documented " +
				"token URL (accounts.spotify.com/api/token), but ships with no Client ID/Secret. " +
				"Register a free Spotify developer app and fill in the Client ID/Secret yourself to " +
				"make this one actually run.",
			BaseURL: "https://api.spotify.com/v1/browse/new-releases", AuthType: AuthOAuth2, Method: "GET",
			Auth: &AuthConfig{OAuth2: &OAuth2Config{ //nolint:gosec // TokenURL below is a public token endpoint URL, not a credential (G101 false positive) -- this seed ships with no Client ID/Secret, see Description above
				GrantType: "client_credentials", TokenURL: "https://accounts.spotify.com/api/token",
			}},
			OpenAPISpec: openAPISpecFor("Spotify Web API (bring your own app)"),
			BuiltIn:     true,
			Seed:        seedorigin.Stamp(2),
		},
		{
			ID: ExampleQueryParamID, Label: "Example: Query-param API key (httpbin.org)",
			Description: "Sends ?apikey=<secret> in the URL's query string against httpbin.org/get, " +
				"which echoes back the query it received. Same self-consistency-only caveat as the " +
				"header-based API-key example (httpbin doesn't validate the value).",
			BaseURL: "https://httpbin.org/get", AuthType: AuthQueryParam, Method: "GET",
			OpenAPISpec: openAPISpecFor("httpbin query echo"),
			BuiltIn:     true,
			Seed:        seedorigin.Stamp(2),
		},
		{
			ID: ExampleConfluencePageReadID, Label: "Example: Confluence page (PAT)",
			Description: "Reads a Confluence page as rendered HTML. Set your Confluence base URL and paste " +
				"a personal access token. Works with self-hosted Confluence; cloud sites use a different " +
				"path and Basic auth.",
			BaseURL: "https://example.invalid", AuthType: AuthBearer, Method: "GET",
			OpenAPISpec: confluencePageReadSpec,
			BuiltIn:     true,
			Seed:        seedorigin.Stamp(1),
		},
		{
			ID: ExampleJiraSearchID, Label: "Example: Jira search (PAT)",
			Description: "Searches Jira issues with a JQL query. Set your Jira base URL and paste a " +
				"personal access token. Works with self-hosted Jira; cloud sites use /rest/api/3/search/jql " +
				"and Basic auth.",
			BaseURL: "https://example.invalid", AuthType: AuthBearer, Method: "GET",
			OpenAPISpec: jiraSearchSpec,
			BuiltIn:     true,
			Seed:        seedorigin.Stamp(1),
		},
	}
}
