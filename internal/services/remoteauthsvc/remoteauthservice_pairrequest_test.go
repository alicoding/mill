package remoteauthsvc

import (
	"testing"
	"time"

	"github.com/alicoding/mill/internal/domain/notification"
	"github.com/alicoding/mill/internal/domain/usererror"
	"github.com/alicoding/mill/internal/services/notificationsvc"
	"github.com/alicoding/mill/internal/services/servicetest"
)

// fakePairRequestChannel records every event handed to Publish, so a
// test can assert what RequestPairing published without any real
// OS/browser notification machinery -- the same minimal double
// notificationsvc's own tests use.
type fakePairRequestChannel struct {
	name  string
	calls []notification.Event
}

func (c *fakePairRequestChannel) Name() string                          { return c.name }
func (c *fakePairRequestChannel) ShouldDeliver(notification.Event) bool { return true }
func (c *fakePairRequestChannel) Deliver(evt notification.Event, _ notification.Record) error {
	c.calls = append(c.calls, evt)
	return nil
}

func newPairRequestTestService(t *testing.T) (*RemoteAuthService, *fakePairRequestChannel) {
	t.Helper()
	s := newBrowserTestService(t)
	notif := notificationsvc.New(servicetest.NewFakeStore())
	ch := &fakePairRequestChannel{name: "test-channel"}
	notif.RegisterChannel(ch)
	s.SetNotificationService(notif)
	return s, ch
}

// TestRequestPairing_MintsSixDigitCodeAndPublishes pins the whole
// nearby-flow mint step: a fresh 6-digit numeric code and opaque
// request id, and a notification published through the spine naming
// the SAME code (goal 0379 Decision 3).
func TestRequestPairing_MintsSixDigitCodeAndPublishes(t *testing.T) {
	s, ch := newPairRequestTestService(t)

	info, err := s.RequestPairing("Chrome", "127.0.0.1")
	if err != nil {
		t.Fatalf("RequestPairing() = %v, want nil error", err)
	}
	if len(info.Code) != 6 {
		t.Fatalf("code = %q, want 6 digits", info.Code)
	}
	for _, c := range info.Code {
		if c < '0' || c > '9' {
			t.Fatalf("code = %q, want digits only", info.Code)
		}
	}
	if info.RequestID == "" {
		t.Fatal("RequestID is empty, want an opaque id")
	}
	if len(ch.calls) != 1 {
		t.Fatalf("channel delivered %d times, want 1", len(ch.calls))
	}
	evt := ch.calls[0]
	if evt.Type != "browser-pair-request" {
		t.Errorf("Type = %q, want browser-pair-request", evt.Type)
	}
	if evt.DedupeKey != info.RequestID || evt.SourceRef != info.RequestID {
		t.Errorf("DedupeKey/SourceRef = %q/%q, want both %q", evt.DedupeKey, evt.SourceRef, info.RequestID)
	}
	if evt.Title != "Chrome wants to pair" {
		t.Errorf("Title = %q, want %q", evt.Title, "Chrome wants to pair")
	}
	if evt.Body != "Code "+info.Code {
		t.Errorf("Body = %q, want the same code the popup shows", evt.Body)
	}
	if len(evt.Targets) != 1 || evt.Targets[0] != "desktop-only" {
		t.Errorf("Targets = %v, want the desktop-only sentinel that excludes every phone (goal 0379 S2)", evt.Targets)
	}
}

// TestRequestPairing_ReplacesOutstandingRequest pins the single-live-
// request rule: minting a second request makes the first's id read as
// expired on PairingStatus, the same "single live code" shape
// mintCode already gives the typed path.
func TestRequestPairing_ReplacesOutstandingRequest(t *testing.T) {
	s, _ := newPairRequestTestService(t)

	first, err := s.RequestPairing("Chrome", "127.0.0.1")
	if err != nil {
		t.Fatalf("RequestPairing() = %v, want nil error", err)
	}
	if _, err := s.RequestPairing("Firefox", "127.0.0.1"); err != nil {
		t.Fatalf("RequestPairing() second = %v, want nil error", err)
	}

	if status := s.PairingStatus(first.RequestID); status.Status != pairingRequestStatusExpired {
		t.Fatalf("PairingStatus(replaced id) = %+v, want expired", status)
	}
}

// TestPairingStatus_AcceptedMatchesPairBrowserShape pins the
// acceptance contract: the same BrowserPairing shape PairBrowser
// returns, a real functioning credential ValidateBrowserToken accepts.
func TestPairingStatus_AcceptedMatchesPairBrowserShape(t *testing.T) {
	s, _ := newPairRequestTestService(t)

	info, err := s.RequestPairing("Chrome", "127.0.0.1")
	if err != nil {
		t.Fatalf("RequestPairing() = %v, want nil error", err)
	}
	pairing, err := s.AcceptPairingRequest(info.RequestID)
	if err != nil {
		t.Fatalf("AcceptPairingRequest() = %v, want nil error", err)
	}
	if len(pairing.Token) != 64 {
		t.Fatalf("token length = %d, want 64 hex chars (the same shape PairBrowser mints)", len(pairing.Token))
	}
	if _, ok := s.ValidateBrowserToken(pairing.Token); !ok {
		t.Fatal("ValidateBrowserToken(accepted token) = false, want a live credential")
	}

	status := s.PairingStatus(info.RequestID)
	if status.Status != pairingRequestStatusAccepted || status.Token != pairing.Token || status.DeviceID != pairing.DeviceID || status.Label != "Chrome" {
		t.Fatalf("PairingStatus(accepted) = %+v, want it to mirror AcceptPairingRequest's own response", status)
	}
}

// TestDenyPairingRequest_NeverIssuesAToken pins the fail-closed Deny
// path: pair-status never carries a token once denied.
func TestDenyPairingRequest_NeverIssuesAToken(t *testing.T) {
	s, _ := newPairRequestTestService(t)

	info, err := s.RequestPairing("Chrome", "127.0.0.1")
	if err != nil {
		t.Fatalf("RequestPairing() = %v, want nil error", err)
	}
	if err := s.DenyPairingRequest(info.RequestID); err != nil {
		t.Fatalf("DenyPairingRequest() = %v, want nil error", err)
	}

	status := s.PairingStatus(info.RequestID)
	if status.Status != pairingRequestStatusDenied || status.Token != "" {
		t.Fatalf("PairingStatus(denied) = %+v, want denied with no token", status)
	}
	if _, err := s.AcceptPairingRequest(info.RequestID); err == nil {
		t.Fatal("AcceptPairingRequest(already denied) = nil error, want a refusal")
	}
}

// TestPairingStatus_StaleOrUnknownID_NeverReturnsToken pins the
// Acceptance bullet directly: a mismatched/stale requestId never
// returns a token, read exactly like an expired one so a guess learns
// nothing about whether an id ever existed.
func TestPairingStatus_StaleOrUnknownID_NeverReturnsToken(t *testing.T) {
	s, _ := newPairRequestTestService(t)

	if _, err := s.RequestPairing("Chrome", "127.0.0.1"); err != nil {
		t.Fatalf("RequestPairing() = %v, want nil error", err)
	}
	status := s.PairingStatus("not-a-real-request-id")
	if status.Status != pairingRequestStatusExpired || status.Token != "" {
		t.Fatalf("PairingStatus(unknown id) = %+v, want expired with no token", status)
	}
}

// TestAcceptPairingRequest_AfterExpiry_Rejected pins the TTL's fail-
// closed direction: Accept after the deadline is refused server-side,
// mirroring validatePairingCode's own single-use-or-expired rule.
func TestAcceptPairingRequest_AfterExpiry_Rejected(t *testing.T) {
	s, _ := newPairRequestTestService(t)

	info, err := s.RequestPairing("Chrome", "127.0.0.1")
	if err != nil {
		t.Fatalf("RequestPairing() = %v, want nil error", err)
	}
	s.mu.Lock()
	s.pairRequest.expiresAt = time.Now().Add(-time.Second)
	s.mu.Unlock()

	if _, err := s.AcceptPairingRequest(info.RequestID); err == nil {
		t.Fatal("AcceptPairingRequest(expired) = nil error, want a refusal")
	}
	if status := s.PairingStatus(info.RequestID); status.Status != pairingRequestStatusExpired {
		t.Fatalf("PairingStatus(lapsed TTL) = %+v, want expired", status)
	}
}

// TestAcceptPairingRequest_Twice_SecondRejected pins Accept's own
// idempotency: a second Accept on an already-resolved request never
// mints a second device.
func TestAcceptPairingRequest_Twice_SecondRejected(t *testing.T) {
	s, _ := newPairRequestTestService(t)

	info, err := s.RequestPairing("Chrome", "127.0.0.1")
	if err != nil {
		t.Fatalf("RequestPairing() = %v, want nil error", err)
	}
	if _, err := s.AcceptPairingRequest(info.RequestID); err != nil {
		t.Fatalf("AcceptPairingRequest() = %v, want nil error", err)
	}
	if _, err := s.AcceptPairingRequest(info.RequestID); err == nil {
		t.Fatal("AcceptPairingRequest(already accepted) = nil error, want a refusal")
	}
	if len(s.ListBrowsers()) != 1 {
		t.Fatalf("ListBrowsers() = %d, want exactly 1 device minted", len(s.ListBrowsers()))
	}
}

// TestRequestPairing_SharesPairBrowserRateLimitBucket pins that a
// source locked out by repeated bad pairing codes is ALSO refused a
// pairing request -- one bucket, keyed by source, not a second trust
// model (goal 0379's "shares PairBrowser's rate-limit bucket").
func TestRequestPairing_SharesPairBrowserRateLimitBucket(t *testing.T) {
	s, _ := newPairRequestTestService(t)
	const source = "127.0.0.1"

	for i := 0; i < maxFailuresBeforeLockout; i++ {
		if _, err := s.PairBrowser("WRONGCODE", "Chrome", source); err == nil {
			t.Fatalf("PairBrowser(wrong code) attempt %d = nil error, want a refusal", i)
		}
	}

	_, err := s.RequestPairing("Chrome", source)
	declared, ok := usererror.Of(err)
	if !ok || declared.Code != CodePairingLockedOut {
		t.Fatalf("RequestPairing(locked-out source) = %v, want code %q", err, CodePairingLockedOut)
	}
}

// TestPendingPairingRequest_ReflectsOnlyALivePendingOne pins Settings'
// own poll: nothing pending reads as a zero-value RequestID, and a
// resolved (accepted/denied) request stops showing as pending even
// though it is still the service's own s.pairRequest.
func TestPendingPairingRequest_ReflectsOnlyALivePendingOne(t *testing.T) {
	s, _ := newPairRequestTestService(t)

	if pending := s.PendingPairingRequest(); pending.RequestID != "" {
		t.Fatalf("PendingPairingRequest() = %+v, want nothing pending yet", pending)
	}

	info, err := s.RequestPairing("Chrome", "127.0.0.1")
	if err != nil {
		t.Fatalf("RequestPairing() = %v, want nil error", err)
	}
	pending := s.PendingPairingRequest()
	if pending.RequestID != info.RequestID || pending.Code != info.Code || pending.Label != "Chrome" {
		t.Fatalf("PendingPairingRequest() = %+v, want it to mirror the minted request", pending)
	}

	if _, err := s.AcceptPairingRequest(info.RequestID); err != nil {
		t.Fatalf("AcceptPairingRequest() = %v, want nil error", err)
	}
	if pending := s.PendingPairingRequest(); pending.RequestID != "" {
		t.Fatalf("PendingPairingRequest() after accept = %+v, want nothing pending", pending)
	}
}
