package oauth2client

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestToken_FetchesFromTokenEndpoint(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"access_token":"at-abc","token_type":"Bearer","expires_in":3600}`))
	}))
	defer srv.Close()

	tokenType, accessToken, err := Token("client-1", "secret-1", srv.URL, "")
	if err != nil {
		t.Fatalf("Token returned error: %v", err)
	}
	if tokenType != "Bearer" || accessToken != "at-abc" {
		t.Errorf("Token() = (%q, %q), want (\"Bearer\", \"at-abc\")", tokenType, accessToken)
	}
}

func TestToken_ReusesCachedTokenSource(t *testing.T) {
	calls := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"access_token":"at-cached","token_type":"Bearer","expires_in":3600}`))
	}))
	defer srv.Close()

	if _, _, err := Token("client-2", "secret-2", srv.URL, ""); err != nil {
		t.Fatalf("first Token call returned error: %v", err)
	}
	if _, _, err := Token("client-2", "secret-2", srv.URL, ""); err != nil {
		t.Fatalf("second Token call returned error: %v", err)
	}
	if calls != 1 {
		t.Errorf("token endpoint was hit %d times, want 1 (the second call should reuse the cached, still-valid TokenSource)", calls)
	}
}

func TestToken_ErrorFromTokenEndpoint(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
	}))
	defer srv.Close()

	if _, _, err := Token("client-3", "wrong-secret", srv.URL, ""); err == nil {
		t.Fatal("Token with a 401 token endpoint returned nil error, want an error")
	}
}
