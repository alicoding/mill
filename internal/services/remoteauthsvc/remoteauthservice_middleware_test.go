package remoteauthsvc

import (
	"context"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/alicoding/mill/internal/adapters/settings"
)

// appContentMarker is what the "real app" handler behind the
// middleware serves in these tests, so a test can assert its absence
// as proof the pairing page -- never a partial app shell -- was
// served instead.
const appContentMarker = "mill-app-shell-content"

func newTestService(t *testing.T) *Service {
	t.Helper()
	store, err := settings.New(filepath.Join(t.TempDir(), "settings.json"))
	if err != nil {
		t.Fatalf("settings.New() = %v, want nil error", err)
	}
	return New(store, slog.New(slog.DiscardHandler))
}

func appHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(appContentMarker))
	})
}

// newRequest builds a GET request with remoteAddr as the connection's
// origin -- every case in this file that needs an unauthenticated or
// already-cookied GET uses this; the pairing-code POST path has its
// own submitCode helper below.
func newRequest(target, remoteAddr string) *http.Request {
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, target, nil)
	req.RemoteAddr = remoteAddr
	return req
}

// TestMiddleware_LoopbackPassesUntouched pins the SLICE 1 DESIGN
// CONTRACT's central invariant: the desktop webview (loopback) must
// never see a login, regardless of pairing state.
func TestMiddleware_LoopbackPassesUntouched(t *testing.T) {
	s := newTestService(t)
	handler := s.Middleware()(appHandler())

	for _, remoteAddr := range []string{"127.0.0.1:54321", "[::1]:54321"} {
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, newRequest("/", remoteAddr))

		if rec.Code != http.StatusOK {
			t.Errorf("loopback %s: status = %d, want 200", remoteAddr, rec.Code)
		}
		if rec.Body.String() != appContentMarker {
			t.Errorf("loopback %s: body = %q, want app content", remoteAddr, rec.Body.String())
		}
	}
}

// TestMiddleware_NonLoopbackWithoutToken_GetsPairingPageNeverAppContent
// covers both the plain-GET case and a non-pairing-endpoint request --
// an unpaired non-loopback caller must never see app content on any
// path.
func TestMiddleware_NonLoopbackWithoutToken_GetsPairingPageNeverAppContent(t *testing.T) {
	s := newTestService(t)
	handler := s.Middleware()(appHandler())

	for _, target := range []string{"/", "/some/asset.js", "/wails/runtime.js"} {
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, newRequest(target, "203.0.113.5:1234"))

		if rec.Code != http.StatusUnauthorized {
			t.Errorf("%s: status = %d, want 401", target, rec.Code)
		}
		body := rec.Body.String()
		if strings.Contains(body, appContentMarker) {
			t.Errorf("%s: body leaked app content: %q", target, body)
		}
		if !strings.Contains(body, "Pair this device") {
			t.Errorf("%s: body = %q, want the pairing page", target, body)
		}
	}
}

func submitCode(t *testing.T, handler http.Handler, remoteAddr, code string) *httptest.ResponseRecorder {
	t.Helper()
	form := url.Values{pairingCodeFormKey: {code}}
	req := httptest.NewRequestWithContext(context.Background(), http.MethodPost, PairSubmitPath, strings.NewReader(form.Encode()))
	req.RemoteAddr = remoteAddr
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	return rec
}

// TestMiddleware_WrongCodeRejected covers the base negative path: a
// code that was never issued must never mint a token.
func TestMiddleware_WrongCodeRejected(t *testing.T) {
	s := newTestService(t)
	handler := s.Middleware()(appHandler())

	rec := submitCode(t, handler, "203.0.113.5:1234", "ZZZZZZZZ")

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), pairingErrorWrongCode) {
		t.Errorf("body = %q, want the wrong-code message", rec.Body.String())
	}
	if rec.Result().Cookies() != nil && len(rec.Result().Cookies()) != 0 {
		t.Errorf("a wrong code must never set a device cookie, got %v", rec.Result().Cookies())
	}
}

// TestMiddleware_RateLimitEngagesAfterFiveFailures pins the SLICE 1
// DESIGN CONTRACT's abuse-resistance number: 5 failures from one
// source lock that source out.
func TestMiddleware_RateLimitEngagesAfterFiveFailures(t *testing.T) {
	s := newTestService(t)
	handler := s.Middleware()(appHandler())
	const source = "203.0.113.9:1"

	for i := 0; i < maxFailuresBeforeLockout; i++ {
		rec := submitCode(t, handler, source, "WRONGONE")
		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("attempt %d: status = %d, want 401 (not yet locked out)", i+1, rec.Code)
		}
	}

	rec := submitCode(t, handler, source, "WRONGONE")
	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("attempt %d: status = %d, want 429 (locked out)", maxFailuresBeforeLockout+1, rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "Too many attempts") {
		t.Errorf("body = %q, want the lockout message", rec.Body.String())
	}

	// A different source IP is unaffected -- the lockout key is the
	// remote IP alone (never the port), and is per-source, never global.
	other := submitCode(t, handler, "203.0.113.99:1", "WRONGONE")
	if other.Code != http.StatusUnauthorized {
		t.Errorf("other source: status = %d, want 401 (still able to attempt)", other.Code)
	}
}

// TestMiddleware_ExpiredCodeRejected exercises the TTL path directly
// (white-box: this test file is in package remoteauthsvc) rather than
// sleeping 5 real minutes.
func TestMiddleware_ExpiredCodeRejected(t *testing.T) {
	s := newTestService(t)
	handler := s.Middleware()(appHandler())

	info, err := s.GeneratePairingCode()
	if err != nil {
		t.Fatalf("GeneratePairingCode() = %v, want nil error", err)
	}
	s.mu.Lock()
	s.code.expiresAt = time.Now().Add(-time.Second)
	s.mu.Unlock()

	rec := submitCode(t, handler, "203.0.113.7:1", info.Code)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), pairingErrorWrongCode) {
		t.Errorf("body = %q, want the wrong-code message for an expired code", rec.Body.String())
	}
}

// TestMiddleware_UsedCodeRejected pins single-use: a code that already
// succeeded once must never succeed again.
func TestMiddleware_UsedCodeRejected(t *testing.T) {
	s := newTestService(t)
	handler := s.Middleware()(appHandler())

	info, err := s.GeneratePairingCode()
	if err != nil {
		t.Fatalf("GeneratePairingCode() = %v, want nil error", err)
	}

	first := submitCode(t, handler, "203.0.113.8:1", info.Code)
	if first.Code != http.StatusSeeOther {
		t.Fatalf("first submit: status = %d, want 303", first.Code)
	}

	second := submitCode(t, handler, "203.0.113.8:2", info.Code)
	if second.Code != http.StatusUnauthorized {
		t.Fatalf("second submit of the same code: status = %d, want 401", second.Code)
	}
}

// TestMiddleware_ValidCodeMintsTokenThatThenPasses is the success
// path: a correct code sets a cookie, and that cookie alone (no code
// needed again) then reaches app content.
func TestMiddleware_ValidCodeMintsTokenThatThenPasses(t *testing.T) {
	s := newTestService(t)
	handler := s.Middleware()(appHandler())

	info, err := s.GeneratePairingCode()
	if err != nil {
		t.Fatalf("GeneratePairingCode() = %v, want nil error", err)
	}

	pairRec := submitCode(t, handler, "203.0.113.10:1", info.Code)
	if pairRec.Code != http.StatusSeeOther {
		t.Fatalf("pairing submit: status = %d, want 303", pairRec.Code)
	}
	cookies := pairRec.Result().Cookies()
	if len(cookies) != 1 || cookies[0].Name != DeviceTokenCookieName {
		t.Fatalf("cookies = %v, want exactly one %s cookie", cookies, DeviceTokenCookieName)
	}
	if !cookies[0].HttpOnly || cookies[0].SameSite != http.SameSiteStrictMode {
		t.Errorf("cookie = %+v, want HttpOnly + SameSite=Strict", cookies[0])
	}

	req := newRequest("/", "203.0.113.10:2")
	req.AddCookie(cookies[0])
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK || rec.Body.String() != appContentMarker {
		t.Fatalf("authenticated request: status=%d body=%q, want 200 + app content", rec.Code, rec.Body.String())
	}
}

// TestMiddleware_RevokedTokenRejectedImmediately covers revocation:
// the very next request with a since-revoked cookie must fail, no
// grace window.
func TestMiddleware_RevokedTokenRejectedImmediately(t *testing.T) {
	s := newTestService(t)
	handler := s.Middleware()(appHandler())

	info, err := s.GeneratePairingCode()
	if err != nil {
		t.Fatalf("GeneratePairingCode() = %v, want nil error", err)
	}
	pairRec := submitCode(t, handler, "203.0.113.11:1", info.Code)
	cookie := pairRec.Result().Cookies()[0]

	devices := s.ListDevices()
	if len(devices) != 1 {
		t.Fatalf("ListDevices() = %v, want exactly one paired device", devices)
	}
	if err := s.RevokeDevice(devices[0].ID); err != nil {
		t.Fatalf("RevokeDevice() = %v, want nil error", err)
	}

	req := newRequest("/", "203.0.113.11:2")
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401 (revoked)", rec.Code)
	}
	if strings.Contains(rec.Body.String(), appContentMarker) {
		t.Errorf("revoked cookie reached app content: %q", rec.Body.String())
	}
}
