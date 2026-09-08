package bridgesvc_test

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/alicoding/mill/internal/services/bridgesvc"
	"github.com/alicoding/mill/internal/services/remoteauthsvc"
)

// TestDiscover_LoopbackOnly pins goal 0379's nearby flow: a non-
// loopback caller learns nothing about Mill at all, and a loopback one
// gets the discovery JSON reflecting its own paired state.
func TestDiscover_LoopbackOnly(t *testing.T) {
	auth := &stubAuth{token: "good"}
	handler := bridgesvc.New(auth, slog.New(slog.DiscardHandler)).Handler()

	req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, bridgesvc.DiscoverPath, nil)
	req.RemoteAddr = "203.0.113.9:5555"
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("non-loopback discover status = %d, want %d", rec.Code, http.StatusNotFound)
	}

	req = httptest.NewRequestWithContext(t.Context(), http.MethodGet, bridgesvc.DiscoverPath, nil)
	req.RemoteAddr = "127.0.0.1:5555"
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("loopback discover status = %d, want %d", rec.Code, http.StatusOK)
	}
	var body struct {
		Name   string `json:"name"`
		Paired bool   `json:"paired"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("decoding discover = %v, want nil error", err)
	}
	if body.Name != "Mill" || body.Paired {
		t.Fatalf("discover = %+v, want Mill/unpaired for a bearer-less caller", body)
	}

	req = httptest.NewRequestWithContext(t.Context(), http.MethodGet, bridgesvc.DiscoverPath, nil)
	req.RemoteAddr = "127.0.0.1:5555"
	req.Header.Set("Authorization", "Bearer good")
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	body = struct {
		Name   string `json:"name"`
		Paired bool   `json:"paired"`
	}{}
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("decoding discover = %v, want nil error", err)
	}
	if !body.Paired {
		t.Fatalf("discover with a good bearer token = %+v, want paired", body)
	}
}

// TestPairRequest_MintsThroughTheAuthoritySeam pins that the HTTP
// layer only ever forwards to RequestPairing -- it mints nothing
// itself -- and refuses a non-loopback caller before ever reaching it.
func TestPairRequest_MintsThroughTheAuthoritySeam(t *testing.T) {
	auth := &stubAuth{pairRequestInfo: remoteauthsvc.PairingRequestInfo{RequestID: "req-1", Code: "482913", ExpiresAt: time.Now().Add(2 * time.Minute)}}
	handler := bridgesvc.New(auth, slog.New(slog.DiscardHandler)).Handler()

	req := httptest.NewRequestWithContext(t.Context(), http.MethodPost, bridgesvc.PairRequestPath, strings.NewReader(`{"label":"Chrome"}`))
	req.RemoteAddr = "203.0.113.9:5555"
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("non-loopback pair-request status = %d, want %d", rec.Code, http.StatusNotFound)
	}
	if len(auth.pairRequestCalls) != 0 {
		t.Fatalf("RequestPairing called %d times for a non-loopback caller, want 0", len(auth.pairRequestCalls))
	}

	req = httptest.NewRequestWithContext(t.Context(), http.MethodPost, bridgesvc.PairRequestPath, strings.NewReader(`{"label":"Chrome"}`))
	req.RemoteAddr = "127.0.0.1:5555"
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("loopback pair-request status = %d, want %d", rec.Code, http.StatusOK)
	}
	var info remoteauthsvc.PairingRequestInfo
	if err := json.NewDecoder(rec.Body).Decode(&info); err != nil {
		t.Fatalf("decoding pair-request = %v, want nil error", err)
	}
	if info.RequestID != "req-1" || info.Code != "482913" {
		t.Fatalf("pair-request response = %+v, want the minted request echoed back", info)
	}
	if len(auth.pairRequestCalls) != 1 || auth.pairRequestCalls[0] != "Chrome|127.0.0.1" {
		t.Fatalf("RequestPairing calls = %v, want one call for Chrome from 127.0.0.1", auth.pairRequestCalls)
	}
}

// TestPairRequest_UnreadableBodyRejected pins the same "unreadable
// request" refusal handlePair already gives a malformed POST.
func TestPairRequest_UnreadableBodyRejected(t *testing.T) {
	auth := &stubAuth{}
	handler := bridgesvc.New(auth, slog.New(slog.DiscardHandler)).Handler()

	req := httptest.NewRequestWithContext(t.Context(), http.MethodPost, bridgesvc.PairRequestPath, strings.NewReader(`not json`))
	req.RemoteAddr = "127.0.0.1:5555"
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("unreadable pair-request status = %d, want %d", rec.Code, http.StatusBadRequest)
	}
	if len(auth.pairRequestCalls) != 0 {
		t.Fatalf("RequestPairing called for an unreadable body, want 0 calls")
	}
}

// TestPairStatus_LoopbackOnlyAndForwardsTheID pins the poll's own
// loopback gate and that the query's requestId reaches PairingStatus
// unchanged.
func TestPairStatus_LoopbackOnlyAndForwardsTheID(t *testing.T) {
	auth := &stubAuth{pairStatus: remoteauthsvc.PairingRequestStatus{Status: "accepted", Token: "tok", DeviceID: "browser-1", Label: "Chrome"}}
	handler := bridgesvc.New(auth, slog.New(slog.DiscardHandler)).Handler()

	req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, bridgesvc.PairStatusPath+"?requestId=req-1", nil)
	req.RemoteAddr = "203.0.113.9:5555"
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("non-loopback pair-status status = %d, want %d", rec.Code, http.StatusNotFound)
	}

	req = httptest.NewRequestWithContext(t.Context(), http.MethodGet, bridgesvc.PairStatusPath+"?requestId=req-1", nil)
	req.RemoteAddr = "127.0.0.1:5555"
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("loopback pair-status status = %d, want %d", rec.Code, http.StatusOK)
	}
	var status remoteauthsvc.PairingRequestStatus
	if err := json.NewDecoder(rec.Body).Decode(&status); err != nil {
		t.Fatalf("decoding pair-status = %v, want nil error", err)
	}
	if status.Status != "accepted" || status.Token != "tok" {
		t.Fatalf("pair-status = %+v, want the authority's own answer echoed back", status)
	}
	if len(auth.pairStatusCalls) != 1 || auth.pairStatusCalls[0] != "req-1" {
		t.Fatalf("PairingStatus calls = %v, want one call for req-1", auth.pairStatusCalls)
	}
}
