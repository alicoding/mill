package bridgesvc_test

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/alicoding/mill/internal/services/bridgesvc"
)

// disconnect POSTs the self-revoke door with token as the bearer and
// reports the response status.
func disconnect(t *testing.T, srv *httptest.Server, token string) int {
	t.Helper()
	req, err := http.NewRequestWithContext(t.Context(), http.MethodPost, srv.URL+bridgesvc.DisconnectPath, nil)
	if err != nil {
		t.Fatalf("NewRequestWithContext() = %v, want nil error", err)
	}
	req.Header.Set("Authorization", "Bearer "+token)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("disconnect request = %v, want nil error", err)
	}
	defer func() { _ = resp.Body.Close() }()
	return resp.StatusCode
}

// TestDisconnect_RevokesOnlyTheCallersDeviceIgnoringAnyBodyID pins goal
// 0379 S2's core contract: the bearer token is the ONLY thing that
// decides which device is revoked -- a body naming a foreign device id
// is decoded for nothing, never read.
func TestDisconnect_RevokesOnlyTheCallersDeviceIgnoringAnyBodyID(t *testing.T) {
	auth := &stubAuth{token: "good"}
	_, srv := newService(t, auth)

	req, err := http.NewRequestWithContext(t.Context(), http.MethodPost, srv.URL+bridgesvc.DisconnectPath, strings.NewReader(`{"deviceId":"someone-elses-device"}`))
	if err != nil {
		t.Fatalf("NewRequestWithContext() = %v, want nil error", err)
	}
	req.Header.Set("Authorization", "Bearer good")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("disconnect request = %v, want nil error", err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("disconnect status = %d, want %d", resp.StatusCode, http.StatusNoContent)
	}
	if len(auth.revokeCalls) != 1 || auth.revokeCalls[0] != "browser-1" {
		t.Fatalf("RevokeDevice calls = %v, want exactly one call for browser-1 (the token-resolved device, never the body's foreign id)", auth.revokeCalls)
	}
}

// TestDisconnect_BadTokenIsUnauthorized pins the 401 path: an absent,
// wrong or malformed bearer never reaches RevokeDevice.
func TestDisconnect_BadTokenIsUnauthorized(t *testing.T) {
	auth := &stubAuth{token: "good"}
	_, srv := newService(t, auth)

	for _, tc := range []struct{ name, header string }{
		{"no header", ""},
		{"wrong token", "Bearer wrong"},
		{"not a bearer", "good"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			req, err := http.NewRequestWithContext(t.Context(), http.MethodPost, srv.URL+bridgesvc.DisconnectPath, nil)
			if err != nil {
				t.Fatalf("NewRequestWithContext() = %v, want nil error", err)
			}
			if tc.header != "" {
				req.Header.Set("Authorization", tc.header)
			}
			resp, err := http.DefaultClient.Do(req)
			if err != nil {
				t.Fatalf("disconnect request = %v, want nil error", err)
			}
			defer func() { _ = resp.Body.Close() }()
			if resp.StatusCode != http.StatusUnauthorized {
				t.Fatalf("status = %d, want %d", resp.StatusCode, http.StatusUnauthorized)
			}
		})
	}
	if len(auth.revokeCalls) != 0 {
		t.Fatalf("RevokeDevice called %d times for an unauthorized caller, want 0", len(auth.revokeCalls))
	}
}

// TestDisconnect_SecondCallIsUnauthorized pins that a token, once
// revoked, cannot disconnect again -- the SAME rule
// ValidateBrowserToken already enforces for every other bridge route
// (TestResult_RevokedBrowserIsRefusedImmediately's sibling).
func TestDisconnect_SecondCallIsUnauthorized(t *testing.T) {
	auth := &stubAuth{token: "good"}
	_, srv := newService(t, auth)

	if code := disconnect(t, srv, "good"); code != http.StatusNoContent {
		t.Fatalf("first disconnect status = %d, want %d", code, http.StatusNoContent)
	}
	if code := disconnect(t, srv, "good"); code != http.StatusUnauthorized {
		t.Fatalf("second disconnect status = %d, want %d", code, http.StatusUnauthorized)
	}
}

// TestDisconnect_Success_RecordsAcceptedRevokeRow pins goal 0351 S3's
// note: this is the audit trail's first device-trust producer, so its
// shape (action "revoke", actor the browser device) is what a later
// Settings-triggered revoke reuses.
func TestDisconnect_Success_RecordsAcceptedRevokeRow(t *testing.T) {
	auth := &stubAuth{token: "good"}
	_, srv, reader := newAuditedService(t, auth)

	if code := disconnect(t, srv, "good"); code != http.StatusNoContent {
		t.Fatalf("disconnect status = %d, want %d", code, http.StatusNoContent)
	}

	row := latestBridgeCommand(t, reader)
	if row.Action != "revoke" || row.Outcome != "accepted" {
		t.Errorf("row = %+v, want action=revoke outcome=accepted", row)
	}
	if row.Actor.Source != "browser:browser-1" {
		t.Errorf("row Actor.Source = %q, want browser:browser-1", row.Actor.Source)
	}
	if row.Target.Kind != "browser" || row.Target.ID != "browser-1" {
		t.Errorf("row Target = %+v, want browser/browser-1", row.Target)
	}
}

// TestDisconnect_UnauthorizedToken_RecordsRejectedRow mirrors
// TestHandleResult_UnauthorizedToken_RecordsRejectedRow for the new
// door.
func TestDisconnect_UnauthorizedToken_RecordsRejectedRow(t *testing.T) {
	_, srv, reader := newAuditedService(t, &stubAuth{token: "good"})

	if code := disconnect(t, srv, "wrong"); code != http.StatusUnauthorized {
		t.Fatalf("disconnect status = %d, want %d", code, http.StatusUnauthorized)
	}

	row := latestBridgeCommand(t, reader)
	if row.Action != "revoke" || row.Outcome != "rejected" || row.FailureKind != "unauthorized" {
		t.Errorf("row = %+v, want action=revoke outcome=rejected failureKind=unauthorized", row)
	}
}
