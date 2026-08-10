//go:build liveness

package configuresvc

import (
	"testing"

	"github.com/alicoding/mill/internal/adapters/openapispec"
	"github.com/alicoding/mill/internal/domain/httprequest"
)

// TestSeededHTTPRequests_LiveEndpointsRespond is docs/goals/0010 item
// 3: httprequest.BuiltIn()'s own doc comments claim each seed is
// "verified live" (httpbin.org, postman-echo.com) -- a claim that, per
// the goal's own audit, was previously only ever checked by hand at
// development time, never by committed CI. Build-tagged `liveness` so
// it never runs in a normal `go test ./...` (blocking CI, Lefthook, or
// local dev) -- wired into .github/workflows/seed-liveness.yml as its
// own scheduled, advisory, non-blocking job, the same
// continue-on-error precedent ci.yml's own govulncheck job already
// sets for a check whose pass/fail depends on something outside this
// repo's control (there, a vuln DB; here, third-party uptime).
//
// Reuses TestHTTPRequestOperation (configureservice_requesttest.go)
// directly -- the exact production call path Configure's own Test tab
// drives (ADR-0013) -- rather than hand-rolling a second HTTP-calling
// path that could silently diverge from what real users actually run.
func TestSeededHTTPRequests_LiveEndpointsRespond(t *testing.T) {
	for _, r := range httprequest.BuiltIn() {
		r := r
		t.Run(r.Label, func(t *testing.T) {
			if r.ID == httprequest.ExampleOAuth2ID {
				t.Skip("ships with no Client ID/Secret by design (httprequest.BuiltIn's own doc comment) -- OAuth 2.0 fundamentally can't be demonstrated without a registered app, so this isn't independently live-checkable")
			}

			doc, err := openapispec.Parse([]byte(r.OpenAPISpec))
			if err != nil {
				t.Fatalf("parse seeded OpenAPISpec: %v", err)
			}
			ops := doc.Operations()
			if len(ops) != 1 {
				t.Fatalf("seeded request declares %d operations, want exactly 1", len(ops))
			}
			op := ops[0]

			secret := builtInSecrets[r.ID]
			if r.ID == httprequest.ExampleOAuth1ID {
				secret = builtInOAuth1ConsumerSecret
			}

			c := &ConfigureService{}
			result, err := c.TestHTTPRequestOperation(TestHTTPRequestInput{
				BaseURL: r.BaseURL, AuthType: r.AuthType, Auth: r.Auth, JOSE: r.JOSE,
				Headers: r.Headers, Secret: secret, OpenAPISpec: r.OpenAPISpec,
				Path: op.Path, Method: op.Method,
			})
			if err != nil {
				t.Fatalf("TestHTTPRequestOperation: %v", err)
			}
			if result.Error != "" {
				t.Fatalf("transport error calling %s live: %s", r.BaseURL, result.Error)
			}
			if result.StatusCode < 200 || result.StatusCode >= 300 {
				t.Fatalf("%s live call returned status %d, want 2xx -- body: %s", r.BaseURL, result.StatusCode, result.Body)
			}
			t.Logf("%s: HTTP %d in %dms", r.Label, result.StatusCode, result.DurationMs)
		})
	}
}
