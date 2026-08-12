package settingssvc

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/alicoding/mill/internal/domain/httprequest"
)

// ForwardPendingApproval (docs/goals/0023-attention-escalation.md item
// 4) fires the SAME transport tail integration-http/decision-outcome's
// own webhook already share (composition.SendJSONWebhook) -- exercised
// here via the exact injected-seam pattern composition's own webhook
// tests use (SetHTTPRequestLookup), pointed at a real httptest server
// standing in for a seeded HTTPRequest.
func TestForwardPendingApprovalNow_PostsJSONBodyToConfiguredRequest(t *testing.T) {
	var gotBody string
	var gotMethod string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotMethod = r.Method
		b, _ := io.ReadAll(r.Body)
		gotBody = string(b)
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	composition.SetHTTPRequestLookup(func(id string) (composition.ResolvedHTTPRequest, error) {
		if id != "forward-req" {
			t.Errorf("lookup called with id %q, want forward-req", id)
		}
		return composition.ResolvedHTTPRequest{BaseURL: srv.URL, Method: http.MethodPost, AuthType: httprequest.AuthNone}, nil
	})

	s := newTestSettingsService(t)

	if err := s.forwardPendingApprovalNow("forward-req", "abc-1", "a workflow write needs approval", "mcp-write"); err != nil {
		t.Fatalf("forwardPendingApprovalNow: %v", err)
	}
	if gotMethod != http.MethodPost {
		t.Errorf("method = %q, want POST", gotMethod)
	}

	var got struct {
		Kind        string `json:"kind"`
		ID          string `json:"id"`
		Description string `json:"description"`
		CreatedAt   string `json:"createdAt"`
	}
	if err := json.Unmarshal([]byte(gotBody), &got); err != nil {
		t.Fatalf("forwarded body is not valid JSON: %v (%s)", err, gotBody)
	}
	if got.Kind != "mcp-write" || got.ID != "abc-1" || got.Description != "a workflow write needs approval" {
		t.Errorf("forwarded body = %+v, want kind=mcp-write id=abc-1 description=%q", got, "a workflow write needs approval")
	}
	if got.CreatedAt == "" {
		t.Error("forwarded body missing createdAt")
	}
}

// The enabled+configured gate: ForwardPendingApproval spawns nothing
// (no HTTP call at all) when disabled or unconfigured -- default off,
// same fail-safe-toward-no-new-egress posture every other opt-in
// connector in Mill already has (§1.1).
func TestForwardPendingApproval_NoopWhenDisabledOrUnconfigured(t *testing.T) {
	var called bool
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()
	composition.SetHTTPRequestLookup(func(string) (composition.ResolvedHTTPRequest, error) {
		return composition.ResolvedHTTPRequest{BaseURL: srv.URL, AuthType: httprequest.AuthNone}, nil
	})

	s := newTestSettingsService(t)

	// Disabled, unconfigured -- the config check happens synchronously
	// before any goroutine spawns, so no sleep/race is needed here.
	s.ForwardPendingApproval("id-1", "desc", "mcp-write")
	if called {
		t.Fatal("HTTP server was called with forwarding disabled")
	}

	// Enabled but no request configured -- still a no-op.
	if err := s.SetForwardApprovalsEnabled(true); err != nil {
		t.Fatalf("SetForwardApprovalsEnabled: %v", err)
	}
	s.ForwardPendingApproval("id-1", "desc", "mcp-write")
	if called {
		t.Fatal("HTTP server was called with no request configured")
	}
}

// GetAttentionIdleThreshold/SetAttentionIdleThreshold round-trip, and
// its default/invalid-value fallback (docs/goals/0023 item 2).
func TestAttentionIdleThreshold_DefaultAndRoundTrip(t *testing.T) {
	s := newTestSettingsService(t)

	if got := s.GetAttentionIdleThreshold(); got != defaultAttentionIdleThresholdSeconds {
		t.Errorf("default GetAttentionIdleThreshold() = %d, want %d", got, defaultAttentionIdleThresholdSeconds)
	}

	if err := s.SetAttentionIdleThreshold(120); err != nil {
		t.Fatalf("SetAttentionIdleThreshold: %v", err)
	}
	if got := s.GetAttentionIdleThreshold(); got != 120 {
		t.Errorf("GetAttentionIdleThreshold() = %d, want 120", got)
	}

	// A non-positive value resets to the default rather than persisting
	// a nonsensical threshold.
	if err := s.SetAttentionIdleThreshold(0); err != nil {
		t.Fatalf("SetAttentionIdleThreshold(0): %v", err)
	}
	if got := s.GetAttentionIdleThreshold(); got != defaultAttentionIdleThresholdSeconds {
		t.Errorf("GetAttentionIdleThreshold() after 0 = %d, want default %d", got, defaultAttentionIdleThresholdSeconds)
	}
}

// isAway's unfocused branch never touches idletime at all -- an
// unfocused window is always away, regardless of idle time (the OR in
// "idle>=threshold OR unfocused").
func TestIsAway_Unfocused_AlwaysAway(t *testing.T) {
	s := newTestSettingsService(t)
	if !s.isAway(false) {
		t.Error("isAway(false) = false, want true (unfocused is always away)")
	}
}
