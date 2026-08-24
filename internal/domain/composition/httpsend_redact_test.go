package composition

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/alicoding/mill/internal/domain/httprequest"
)

// TestExecuteWorkflow_IntegrationHTTP_ResponseRedacted proves
// sendHTTPRequest's own response text is run through redactSecretsFn
// before it reaches ctx.Payload (goal 0203 S1's own redaction
// requirement, mirroring mcp-tool-call's error-text redaction and
// codeexec.go's own captured-output redaction): a custom Header
// carrying a vault-resolved value could be echoed back by the server,
// and that must never reach the workflow's payload unredacted.
func TestExecuteWorkflow_IntegrationHTTP_ResponseRedacted(t *testing.T) {
	origRedact := redactSecretsFn
	t.Cleanup(func() { redactSecretsFn = origRedact })

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("echo: " + r.Header.Get("X-Api-Key"))) // #nosec G705 -- a test-only fixture simulating a server echoing a request header, not a real reflected-XSS surface
	}))
	defer srv.Close()

	withHTTPRequestLookup(t, func(string) (ResolvedHTTPRequest, error) {
		return ResolvedHTTPRequest{BaseURL: srv.URL, AuthType: httprequest.AuthNone, Headers: map[string]string{"X-Api-Key": "super-secret-fake"}}, nil
	})
	SetSecretRedactor(func(s string) string { return strings.ReplaceAll(s, "super-secret-fake", "[redacted]") })

	nodes, err := ResolveNodeDefaults([]Node{{
		NodeTypeID: "integration-http",
		Config:     map[string]string{"requestId": "conn-1", "path": "/x", "method": http.MethodGet},
	}})
	if err != nil {
		t.Fatalf("ResolveNodeDefaults: %v", err)
	}
	result, err := ExecuteWorkflow(nodes, nil, nil)
	if err != nil {
		t.Fatalf("ExecuteWorkflow: %v", err)
	}
	if strings.Contains(result, "super-secret-fake") {
		t.Fatalf("result leaked the resolved header value: %q", result)
	}
	if !strings.Contains(result, "[redacted]") {
		t.Fatalf("result = %q, want the redaction placeholder", result)
	}
}
