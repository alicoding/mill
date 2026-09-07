package bridgesvc_test

import (
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/alicoding/mill/internal/services/bridgesvc"
)

// TestRoot_ServesAHumanPageWithoutAToken pins the fix for a bare Go
// 404 at the bridge's own address: a human pasting the address into a
// browser must meet Mill's own page, unauthenticated, over loopback.
func TestRoot_ServesAHumanPageWithoutAToken(t *testing.T) {
	_, srv := newService(t, &stubAuth{token: "good"})
	req, err := http.NewRequestWithContext(t.Context(), http.MethodGet, srv.URL+"/", nil)
	if err != nil {
		t.Fatalf("NewRequestWithContext() = %v, want nil error", err)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("root request = %v, want nil error", err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("root status = %d, want %d", resp.StatusCode, http.StatusOK)
	}
	if ct := resp.Header.Get("Content-Type"); ct != "text/html; charset=utf-8" {
		t.Fatalf("root Content-Type = %q, want %q", ct, "text/html; charset=utf-8")
	}
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("reading the root page = %v, want nil error", err)
	}
	if !strings.Contains(string(body), "Mill") || !strings.Contains(string(body), "Settings") {
		t.Fatalf("root page = %q, want it to name Mill and point back to Settings", body)
	}
}

// TestRoot_LoopbackOnly pins that the root page shares the pairing
// exchange's loopback-only, token-free posture -- nothing outside this
// Mac should learn the bridge exists here at all.
func TestRoot_LoopbackOnly(t *testing.T) {
	auth := &stubAuth{token: "good"}
	svc := bridgesvc.New(auth, slog.New(slog.DiscardHandler))

	req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/", nil)
	req.RemoteAddr = "203.0.113.9:5555"
	rec := httptest.NewRecorder()
	svc.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("non-loopback root status = %d, want %d", rec.Code, http.StatusNotFound)
	}
}

// TestRoot_DoesNotAlterOtherRoutes pins that adding the root page
// changed nothing else on the mux: every other route keeps its own
// posture (paired-token routes still refuse an unpaired caller).
func TestRoot_DoesNotAlterOtherRoutes(t *testing.T) {
	_, srv := newService(t, &stubAuth{token: "good"})

	req, err := http.NewRequestWithContext(t.Context(), http.MethodGet, srv.URL+bridgesvc.EventsPath, nil)
	if err != nil {
		t.Fatalf("NewRequestWithContext() = %v, want nil error", err)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("events request = %v, want nil error", err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("unpaired events status = %d, want %d (root must not widen this route's posture)", resp.StatusCode, http.StatusUnauthorized)
	}

	// A genuinely unknown path is still a real 404, not the root page:
	// "{$}" scopes the new route to the exact root, nothing wider.
	unknown, err := http.NewRequestWithContext(t.Context(), http.MethodGet, srv.URL+"/not-a-real-route", nil)
	if err != nil {
		t.Fatalf("NewRequestWithContext() = %v, want nil error", err)
	}
	resp2, err := http.DefaultClient.Do(unknown)
	if err != nil {
		t.Fatalf("unknown-path request = %v, want nil error", err)
	}
	defer func() { _ = resp2.Body.Close() }()
	if resp2.StatusCode != http.StatusNotFound {
		t.Fatalf("unknown path status = %d, want %d", resp2.StatusCode, http.StatusNotFound)
	}
}
