package composition

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/alicoding/mill/internal/domain/connector"
)

// ADR-0015: the full auth-type catalogue, each proven against a real
// httptest.Server -- not just that the strategy function compiles, but
// that the actual request it produces carries the right credentials.
// AuthNone/AuthAPIKey/AuthBearer's own existing tests (execute_test.go)
// passing unmodified after the registry refactor IS the "byte-identical
// behavior" regression proof the ADR names -- not duplicated here.

func TestExecuteWorkflow_IntegrationHTTP_QueryParamAuth(t *testing.T) {
	var gotQuery string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotQuery = r.URL.RawQuery
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	withConnectorLookup(t, func(string) (ResolvedConnector, error) {
		return ResolvedConnector{BaseURL: srv.URL, AuthType: connector.AuthQueryParam, Secret: "qp-secret"}, nil
	})

	nodes, err := ResolveNodeDefaults([]Node{{
		NodeTypeID: "integration-http",
		Config:     map[string]string{"connectorId": "conn-1", "path": "/x", "method": http.MethodGet},
	}})
	if err != nil {
		t.Fatalf("ResolveNodeDefaults returned error: %v", err)
	}
	if _, err := ExecuteWorkflow(nodes, nil, nil); err != nil {
		t.Fatalf("ExecuteWorkflow returned error: %v", err)
	}
	if gotQuery != "apikey=qp-secret" {
		t.Errorf("server received query %q, want apikey=qp-secret", gotQuery)
	}
}

func TestExecuteWorkflow_IntegrationHTTP_HMACAuth(t *testing.T) {
	var gotSig, gotTimestamp string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotSig = r.Header.Get("X-Signature")
		gotTimestamp = r.Header.Get("X-Timestamp")
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	withConnectorLookup(t, func(string) (ResolvedConnector, error) {
		return ResolvedConnector{BaseURL: srv.URL, AuthType: connector.AuthHMAC, Secret: "hmac-secret"}, nil
	})

	nodes, err := ResolveNodeDefaults([]Node{{
		NodeTypeID: "integration-http",
		Config:     map[string]string{"connectorId": "conn-1", "path": "/x", "method": http.MethodGet},
	}})
	if err != nil {
		t.Fatalf("ResolveNodeDefaults returned error: %v", err)
	}
	if _, err := ExecuteWorkflow(nodes, nil, nil); err != nil {
		t.Fatalf("ExecuteWorkflow returned error: %v", err)
	}
	if gotTimestamp == "" {
		t.Fatal("server received no X-Timestamp header")
	}
	wantPayload := http.MethodGet + "\n" + "/x" + "\n" + gotTimestamp + "\n"
	mac := hmac.New(sha256.New, []byte("hmac-secret"))
	_, _ = mac.Write([]byte(wantPayload))
	wantSig := base64.StdEncoding.EncodeToString(mac.Sum(nil))
	if gotSig != wantSig {
		t.Errorf("X-Signature = %q, want %q (HMAC-SHA256 of method+path+timestamp+body)", gotSig, wantSig)
	}
}

func TestExecuteWorkflow_IntegrationHTTP_OAuth1Auth(t *testing.T) {
	var gotAuth string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	withConnectorLookup(t, func(string) (ResolvedConnector, error) {
		return ResolvedConnector{
			BaseURL: srv.URL, AuthType: connector.AuthOAuth1,
			Secret: EncodeOAuth1Secret("consumer-secret", "token-secret"),
			Auth:   &connector.AuthConfig{OAuth1: &connector.OAuth1Config{ConsumerKey: "ck-1", Token: "tok-1"}},
		}, nil
	})

	nodes, err := ResolveNodeDefaults([]Node{{
		NodeTypeID: "integration-http",
		Config:     map[string]string{"connectorId": "conn-1", "path": "/x", "method": http.MethodGet},
	}})
	if err != nil {
		t.Fatalf("ResolveNodeDefaults returned error: %v", err)
	}
	if _, err := ExecuteWorkflow(nodes, nil, nil); err != nil {
		t.Fatalf("ExecuteWorkflow returned error: %v", err)
	}
	if !strings.HasPrefix(gotAuth, `OAuth `) {
		t.Fatalf("Authorization header = %q, want it to start with \"OAuth \"", gotAuth)
	}
	for _, want := range []string{`oauth_consumer_key="ck-1"`, `oauth_token="tok-1"`, `oauth_signature_method="HMAC-SHA1"`, `oauth_signature="`} {
		if !strings.Contains(gotAuth, want) {
			t.Errorf("Authorization header %q missing %q", gotAuth, want)
		}
	}
}

func TestExecuteWorkflow_IntegrationHTTP_OAuth2Auth(t *testing.T) {
	var gotAuth string
	mux := http.NewServeMux()
	mux.HandleFunc("/token", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"access_token":"at-123","token_type":"Bearer","expires_in":3600}`))
	})
	mux.HandleFunc("/resource", func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		w.WriteHeader(http.StatusOK)
	})
	srv := httptest.NewServer(mux)
	defer srv.Close()

	withConnectorLookup(t, func(string) (ResolvedConnector, error) {
		return ResolvedConnector{
			BaseURL: srv.URL, AuthType: connector.AuthOAuth2, Secret: "client-secret",
			Auth: &connector.AuthConfig{OAuth2: &connector.OAuth2Config{
				GrantType: "client_credentials", TokenURL: srv.URL + "/token", ClientID: "client-1",
			}},
		}, nil
	})

	nodes, err := ResolveNodeDefaults([]Node{{
		NodeTypeID: "integration-http",
		Config:     map[string]string{"connectorId": "conn-1", "path": "/resource", "method": http.MethodGet},
	}})
	if err != nil {
		t.Fatalf("ResolveNodeDefaults returned error: %v", err)
	}
	if _, err := ExecuteWorkflow(nodes, nil, nil); err != nil {
		t.Fatalf("ExecuteWorkflow returned error: %v", err)
	}
	if gotAuth != "Bearer at-123" {
		t.Errorf("Authorization header = %q, want %q", gotAuth, "Bearer at-123")
	}
}

func TestExecuteWorkflow_IntegrationHTTP_OAuth1Vendor_NotImplemented(t *testing.T) {
	withConnectorLookup(t, func(string) (ResolvedConnector, error) {
		return ResolvedConnector{BaseURL: "http://example.invalid", AuthType: connector.AuthOAuth1Vendor}, nil
	})
	nodes, err := ResolveNodeDefaults([]Node{{
		NodeTypeID: "integration-http",
		Config:     map[string]string{"connectorId": "conn-1", "path": "/x", "method": http.MethodGet},
	}})
	if err != nil {
		t.Fatalf("ResolveNodeDefaults returned error: %v", err)
	}
	_, err = ExecuteWorkflow(nodes, nil, nil)
	if err == nil || !strings.Contains(err.Error(), "not yet implemented") {
		t.Fatalf("ExecuteWorkflow with AuthOAuth1Vendor = %v, want a clear \"not yet implemented\" error, not a guessed signature", err)
	}
}

func TestExecuteWorkflow_IntegrationHTTP_MTLS_NotImplemented(t *testing.T) {
	withConnectorLookup(t, func(string) (ResolvedConnector, error) {
		return ResolvedConnector{BaseURL: "http://example.invalid", AuthType: connector.AuthMTLS}, nil
	})
	nodes, err := ResolveNodeDefaults([]Node{{
		NodeTypeID: "integration-http",
		Config:     map[string]string{"connectorId": "conn-1", "path": "/x", "method": http.MethodGet},
	}})
	if err != nil {
		t.Fatalf("ResolveNodeDefaults returned error: %v", err)
	}
	_, err = ExecuteWorkflow(nodes, nil, nil)
	if err == nil || !strings.Contains(err.Error(), "not yet implemented") {
		t.Fatalf("ExecuteWorkflow with AuthMTLS = %v, want a clear \"not yet implemented\" error, proving the registry accepts a new AuthType without a real certificate handshake being attempted", err)
	}
}
