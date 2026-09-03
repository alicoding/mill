package httpconnector

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestExecuteConfined_HostAndRedirectConfinement(t *testing.T) {
	other := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte("leaked")) }))
	defer other.Close()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/ok":
			w.Header().Set("X-Probe", "yes")
			_, _ = w.Write([]byte("hello"))
		case "/away":
			http.Redirect(w, r, other.URL+"/", http.StatusFound)
		case "/big":
			_, _ = w.Write([]byte(strings.Repeat("x", 2000)))
		}
	}))
	defer srv.Close()
	host := strings.TrimPrefix(srv.URL, "http://")
	allow := func(h string) bool { return h == host }

	res, err := ExecuteConfined(Request{Method: "GET", URL: srv.URL + "/ok"}, allow, 1000)
	if err != nil || res.StatusCode != 200 || res.Body != "hello" || res.Headers["X-Probe"] != "yes" {
		t.Fatalf("confined GET = %+v, %v", res, err)
	}
	if _, err := ExecuteConfined(Request{Method: "GET", URL: other.URL + "/"}, allow, 1000); err == nil || !strings.Contains(err.Error(), "not declared") {
		t.Errorf("undeclared host must be refused before the request: %v", err)
	}
	if _, err := ExecuteConfined(Request{Method: "GET", URL: srv.URL + "/away"}, allow, 1000); err == nil || !strings.Contains(err.Error(), "undeclared host") {
		t.Errorf("redirect off the declared host must be refused: %v", err)
	}
	if _, err := ExecuteConfined(Request{Method: "GET", URL: srv.URL + "/big"}, allow, 1000); err == nil || !strings.Contains(err.Error(), "byte limit") {
		t.Errorf("oversized body must error, never truncate: %v", err)
	}
	for _, bad := range []string{"file:///etc/passwd", "data:text/plain,hi", "not a url", "https://"} {
		if _, err := ExecuteConfined(Request{Method: "GET", URL: bad}, allow, 1000); err == nil {
			t.Errorf("%q must be refused", bad)
		}
	}
}
