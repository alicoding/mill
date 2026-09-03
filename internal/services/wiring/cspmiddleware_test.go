package wiring

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestCSPMiddleware_SetsPolicyExceptForVendoredViewersAndDevLoop(t *testing.T) {
	t.Setenv("FRONTEND_DEVSERVER_URL", "")
	h := CSPMiddleware()(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) }))
	for path, want := range map[string]bool{"/": true, "/index.html": true, "/plugins/x/main.js": true, "/vendor/pdfjs/web/viewer.html": false, "/vendor/drawio/editor/index.html": false} {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequestWithContext(context.Background(), http.MethodGet, path, nil))
		got := rec.Header().Get("Content-Security-Policy")
		if (got != "") != want {
			t.Errorf("%s: policy present=%v, want %v", path, got != "", want)
		}
		if want && (!strings.Contains(got, "script-src 'self'") || strings.Contains(got, "unsafe-eval") || !strings.Contains(got, "object-src 'none'")) {
			t.Errorf("%s: policy = %q", path, got)
		}
	}
	t.Setenv("FRONTEND_DEVSERVER_URL", "http://localhost:5173")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/", nil))
	if rec.Header().Get("Content-Security-Policy") != "" {
		t.Error("the dev loop got a policy")
	}
}
