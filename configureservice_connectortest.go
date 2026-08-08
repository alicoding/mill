package main

import (
	"fmt"
	"strings"
	"time"

	"github.com/alicoding/mill/internal/adapters/credential"
	"github.com/alicoding/mill/internal/adapters/httpconnector"
	"github.com/alicoding/mill/internal/adapters/openapispec"
	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/alicoding/mill/internal/domain/connector"
)

// TestConnectorRequest carries a connector draft (possibly unsaved --
// docs/adr/0013) plus the one operation to call and example field
// values. Config comes as plain values (BaseURL/AuthType/Headers/
// OpenAPISpec), not a Connector ID, so testing the connector currently
// on screen works identically whether it's brand-new or mid-edit of an
// existing one -- the RPC never reads c.connectors for config, only
// (via ConnectorID, below) as a secret fallback.
type TestConnectorRequest struct {
	// ConnectorID is optional. Set it when editing an existing connector
	// and Secret is left blank ("keep the existing secret," matching
	// ConnectorForm's own Auth-tab caption) -- the RPC then falls back to
	// this connector's stored keychain secret, the same read
	// resolveConnector already does for a real workflow run.
	ConnectorID string
	BaseURL     string
	AuthType    connector.AuthType
	// Auth is the non-secret config for AuthOAuth2/AuthHMAC/AuthOAuth1
	// (ADR-0015) -- nil for the three original AuthTypes.
	Auth *connector.AuthConfig
	// JOSE is Phase 3's optional request/response encryption layer --
	// nil for a connector not using it.
	JOSE    *connector.JOSEConfig
	Headers map[string]string
	// Secret is used as typed, for this call only -- TestConnectorOperation
	// never calls credential.Set, so a tested-then-abandoned draft leaves
	// no keychain trace.
	Secret string
	// JOSEPrivateKeyPEM is the same "used as typed, for this call only"
	// shape as Secret above, but for JOSE.DecryptResponse's own,
	// separately-keychained private key (falls back to
	// joseKeychainID(ConnectorID) when blank, same pattern Secret uses
	// for the AuthType secret).
	JOSEPrivateKeyPEM string
	OpenAPISpec       string
	Path        string
	Method      string
	// Values is a flat map of example (generated or hand-edited) field
	// values keyed by the operation's declared Field.Name, resolved into
	// path/query/header/body placement by openapispec.BuildRequest.
	Values map[string]string
}

// TestConnectorResult is one test call's outcome. Error carries a
// transport-level failure (DNS, timeout, connection refused) as a
// string rather than surfacing it as a Go error -- both this and a
// real HTTP response (including 4xx/5xx, which httpconnector.Execute
// already treats as a non-error return, docs/SPEC.md §4) are equally
// "a test attempt with a result," and the frontend's request/response
// log (ADR-0013 §6) wants to display either uniformly rather than
// branching on error-vs-response.
type TestConnectorResult struct {
	StatusCode int
	Body       string
	Headers    map[string]string
	Error      string
	DurationMs int64
}

// TestConnectorOperation executes one real HTTP call against a
// connector draft's current configuration -- docs/adr/0013's
// test-before-save flow. Runs server-side (not a browser fetch) so it
// can resolve a keychain secret and reuses httpconnector.Execute, the
// same commodity HTTP client + retry policy a real workflow's
// integration-http node already goes through, deliberately not
// special-cased faster/slower.
func (c *ConfigureService) TestConnectorOperation(req TestConnectorRequest) (TestConnectorResult, error) {
	secret := req.Secret
	if secret == "" && req.ConnectorID != "" {
		if stored, err := credential.Get(req.ConnectorID); err == nil {
			secret = stored
		}
	}
	josePrivateKey := req.JOSEPrivateKeyPEM
	if josePrivateKey == "" && req.ConnectorID != "" {
		if stored, err := credential.Get(joseKeychainID(req.ConnectorID)); err == nil {
			josePrivateKey = stored
		}
	}

	doc, err := openapispec.Parse([]byte(req.OpenAPISpec))
	if err != nil {
		return TestConnectorResult{}, fmt.Errorf("configureservice: %w", err)
	}
	op, err := doc.Operation(req.Path, req.Method)
	if err != nil {
		return TestConnectorResult{}, fmt.Errorf("configureservice: %w", err)
	}
	resolvedPath, query, bodyHeaders, body, err := openapispec.BuildRequest(req.Path, op, req.Values)
	if err != nil {
		return TestConnectorResult{}, fmt.Errorf("configureservice: %w", err)
	}

	headers := make(map[string]string, len(req.Headers)+len(bodyHeaders)+1)
	for k, v := range req.Headers {
		headers[k] = v
	}
	for k, v := range bodyHeaders {
		headers[k] = v
	}
	// Same order as the real integration-http exec path
	// (internal/domain/composition/integration.go): JOSE-encrypt the
	// body before Auth is applied, so a signing AuthType signs exactly
	// what's transmitted -- a test run and a real run must diverge
	// nowhere (docs/adr/0013's own "test exactly as it would run" goal).
	body, err = composition.ApplyJOSEEncryption(req.JOSE, body)
	if err != nil {
		return TestConnectorResult{}, fmt.Errorf("configureservice: %w", err)
	}
	if err := composition.ApplyAuth(
		composition.ResolvedConnector{BaseURL: req.BaseURL, AuthType: req.AuthType, Secret: secret, Auth: req.Auth},
		req.Method, resolvedPath, headers, query, body,
	); err != nil {
		return TestConnectorResult{}, fmt.Errorf("configureservice: %w", err)
	}

	url := resolvedPath
	if len(query) > 0 {
		url += "?" + query.Encode()
	}

	start := time.Now()
	resp, err := httpconnector.Execute(httpconnector.Request{
		Method:  req.Method,
		URL:     strings.TrimRight(req.BaseURL, "/") + url,
		Headers: headers,
		Body:    body,
	})
	elapsed := time.Since(start).Milliseconds()
	if err != nil {
		return TestConnectorResult{Error: err.Error(), DurationMs: elapsed}, nil
	}
	respBody := resp.Body
	// Mirrors integration.go: only a successful response is plausibly a
	// real JWE from the vendor -- an error page body run through
	// DecryptJOSEResponse would just fail loudly with a confusing
	// secondary error, obscuring the real (transport-level) one.
	if resp.StatusCode < 400 {
		decrypted, err := composition.DecryptJOSEResponse(req.JOSE, josePrivateKey, resp.Body)
		if err != nil {
			return TestConnectorResult{Error: err.Error(), DurationMs: elapsed}, nil
		}
		respBody = decrypted
	}
	return TestConnectorResult{
		StatusCode: resp.StatusCode, Body: respBody, Headers: resp.Headers, DurationMs: elapsed,
	}, nil
}
