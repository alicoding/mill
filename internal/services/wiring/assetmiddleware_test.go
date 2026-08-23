//go:build !server

package wiring

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

// Desktop-build only by construction: under the server tag this
// function returns the real gate, which is exactly the behaviour the
// server build is supposed to have.
//
// TestAssetMiddleware_DesktopBuildDoesNotGate pins the desktop lockout:
// a desktop build serves assets in-process to its own webview, and Wails
// substitutes a placeholder RemoteAddr that is not loopback. Arming the
// remote-access gate there challenged the app against itself, with no
// code able to exist to answer it. This test runs without the server
// build tag, so it asserts the pass-through.
func TestAssetMiddleware_DesktopBuildDoesNotGate(t *testing.T) {
	served := false
	h := AssetMiddleware(nil)(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		served = true
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/", nil)
	req.RemoteAddr = "192.0.2.1:1234" // what Wails substitutes for a webview request
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if !served {
		t.Fatal("a desktop build must serve the app, never the pairing page")
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}
}
