package remoteauthsvc

import (
	"net/http"
	"strings"
	"testing"
	"time"
)

// TestPairingPage_ServerAndDesktopModeRenderDifferentCopy pins SLICE 2
// DESIGN CONTRACT item 1: the pairing page's instructions are chosen
// by the server for its own mode, and must actually differ -- a
// browser cannot tell a headless server from a desktop build, so a
// single sentence wrong for half of deployments is exactly the
// defect this fixes.
func TestPairingPage_ServerAndDesktopModeRenderDifferentCopy(t *testing.T) {
	server := newTestService(t)
	server.BootstrapPairingCode(true)
	desktop := newTestService(t)
	desktop.BootstrapPairingCode(false)

	serverBody := submitCode(t, server.Middleware()(appHandler()), "203.0.113.40:1", "WRONGONE").Body.String()
	desktopBody := submitCode(t, desktop.Middleware()(appHandler()), "203.0.113.41:1", "WRONGONE").Body.String()

	// html/template escapes the apostrophe in "server's" as &#39;. The
	// duration disclosure also mentions "Settings" on every render, so
	// these assertions target the INSTRUCTIONS sentence specifically,
	// not a bare substring search over the whole page.
	if !strings.Contains(serverBody, "Find the pairing code in this server&#39;s log.") {
		t.Errorf("server mode body = %q, want it to name the log as the channel", serverBody)
	}
	if strings.Contains(serverBody, "Open Settings") {
		t.Errorf("server mode body = %q, must not point at Settings (no window to show it in)", serverBody)
	}
	if !strings.Contains(desktopBody, "Open Settings") {
		t.Errorf("desktop mode body = %q, want it to name Settings > Remote access", desktopBody)
	}
	if strings.Contains(desktopBody, "server&#39;s log") {
		t.Errorf("desktop mode body = %q, must not point at a server log", desktopBody)
	}
	if serverBody == desktopBody {
		t.Fatalf("server and desktop mode rendered identical copy, want them to differ")
	}
}

// TestPairingPage_DurationMessageMatchesCookieLifetime pins that the
// duration disclosure is DERIVED from cookieLifetime, not a
// hand-typed number that can drift from it.
func TestPairingPage_DurationMessageMatchesCookieLifetime(t *testing.T) {
	if cookieLifetime != 365*24*time.Hour {
		t.Fatalf("cookieLifetime = %v, want the test's own assumption of 365 days -- update humanizeDuration's expectation below if this const changes", cookieLifetime)
	}
	want := "Once paired, this device stays signed in for 1 year. You can revoke it anytime in Settings."
	if pairingDurationMessage != want {
		t.Errorf("pairingDurationMessage = %q, want %q", pairingDurationMessage, want)
	}

	s := newTestService(t)
	body := submitCode(t, s.Middleware()(appHandler()), "203.0.113.42:1", "WRONGONE").Body.String()
	if !strings.Contains(body, want) {
		t.Errorf("pairing page body = %q, want the duration disclosure present", body)
	}
}

func TestHumanizeDuration_WholeUnitsAcrossRanges(t *testing.T) {
	cases := []struct {
		d    time.Duration
		want string
	}{
		{18 * time.Hour, "0 days"},
		{3 * 24 * time.Hour, "3 days"},
		{10 * 24 * time.Hour, "1 week"},
		{45 * 24 * time.Hour, "1 month"},
		{365 * 24 * time.Hour, "1 year"},
		{2 * 365 * 24 * time.Hour, "2 years"},
	}
	for _, c := range cases {
		if got := humanizeDuration(c.d); got != c.want {
			t.Errorf("humanizeDuration(%v) = %q, want %q", c.d, got, c.want)
		}
	}
}

// TestPairingPage_ResendConfirmationMatchesMode pins the resend
// success message's own per-mode copy (SLICE 2 DESIGN CONTRACT item
// 2's "confirmation matching the mode").
func TestPairingPage_ResendConfirmationMatchesMode(t *testing.T) {
	server := newTestService(t)
	server.BootstrapPairingCode(true)
	desktop := newTestService(t)
	desktop.BootstrapPairingCode(false)

	serverBody := submitResendBody(t, server, "203.0.113.43:1")
	desktopBody := submitResendBody(t, desktop, "203.0.113.44:1")

	if !strings.Contains(serverBody, "A new code is in this server&#39;s log.") {
		t.Errorf("server resend body = %q, want the server confirmation", serverBody)
	}
	if !strings.Contains(desktopBody, "A new code is showing in Settings") {
		t.Errorf("desktop resend body = %q, want the desktop confirmation", desktopBody)
	}
}

func submitResendBody(t *testing.T, s *RemoteAuthService, remoteAddr string) string {
	t.Helper()
	rec := submitResend(t, s.Middleware()(appHandler()), remoteAddr)
	if rec.Code != http.StatusOK {
		t.Fatalf("resend: status = %d, want 200", rec.Code)
	}
	return rec.Body.String()
}
