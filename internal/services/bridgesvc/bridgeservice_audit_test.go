package bridgesvc_test

import (
	"context"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/alicoding/mill/internal/adapters/auditstore"
	"github.com/alicoding/mill/internal/domain/audit"
	"github.com/alicoding/mill/internal/domain/browserbridge"
	"github.com/alicoding/mill/internal/domain/usererror"
	"github.com/alicoding/mill/internal/services/bridgesvc"
	"github.com/alicoding/mill/internal/services/remoteauthsvc"
)

// newAuditedService mirrors newService, additionally wiring an audit
// store at a fresh temp file -- returns a second, independent reader
// connection to the same file so a test can List what the service
// itself wrote (auditstore.Open's own doc comment: an independent
// connection is the adopted pattern every producer's own store uses).
func newAuditedService(t *testing.T, auth *stubAuth) (*bridgesvc.BridgeService, *httptest.Server, *auditstore.Store) {
	t.Helper()
	svc, srv := newService(t, auth)
	dbPath := filepath.Join(t.TempDir(), "execution.db")
	svc.OpenAudit(dbPath, slog.New(slog.DiscardHandler))
	t.Cleanup(func() { _ = svc.CloseAudit() })
	reader, err := auditstore.Open(dbPath)
	if err != nil {
		t.Fatalf("auditstore.Open: %v", err)
	}
	t.Cleanup(func() { _ = reader.Close() })
	return svc, srv, reader
}

// latestBridgeCommand returns the newest bridge-command row, or fails
// the test if none exists.
func latestBridgeCommand(t *testing.T, reader *auditstore.Store) audit.Entry {
	t.Helper()
	page, err := reader.List(context.Background(), auditstore.Filter{Kinds: []audit.Kind{audit.KindBridgeCommand}, Limit: 1})
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(page.Entries) == 0 {
		t.Fatal("no bridge-command row was recorded")
	}
	return page.Entries[0]
}

func TestPair_Success_RecordsAcceptedRow(t *testing.T) {
	auth := &stubAuth{token: "minted"}
	svc, _, reader := newAuditedService(t, auth)
	req := httptest.NewRequestWithContext(t.Context(), http.MethodPost, bridgesvc.PairPath, strings.NewReader(`{"code":"ABCD2345","label":"Chrome"}`))
	req.RemoteAddr = "127.0.0.1:5555"
	rec := httptest.NewRecorder()
	svc.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("pair status = %d, want 200", rec.Code)
	}

	row := latestBridgeCommand(t, reader)
	if row.Action != "pair" || row.Outcome != "accepted" {
		t.Errorf("row = %+v, want action=pair outcome=accepted", row)
	}
	if row.Actor.Source != "browser:browser-1" {
		t.Errorf("row Actor.Source = %q, want browser:browser-1", row.Actor.Source)
	}
}

func TestPair_RateLimited_RecordsRejectedRowWithFailureKind(t *testing.T) {
	auth := &stubAuth{pairErr: usererror.New(remoteauthsvc.CodePairingLockedOut, "Too many wrong codes. Wait a minute and try again.")}
	svc, _, reader := newAuditedService(t, auth)
	req := httptest.NewRequestWithContext(t.Context(), http.MethodPost, bridgesvc.PairPath, strings.NewReader(`{"code":"NOPE"}`))
	req.RemoteAddr = "127.0.0.1:5555"
	rec := httptest.NewRecorder()
	svc.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("pair status = %d, want 401", rec.Code)
	}

	row := latestBridgeCommand(t, reader)
	if row.Action != "pair" || row.Outcome != "rejected" || row.FailureKind != "rate-limited" {
		t.Errorf("row = %+v, want action=pair outcome=rejected failureKind=rate-limited", row)
	}
}

func TestHandleResult_UnauthorizedToken_RecordsRejectedRow(t *testing.T) {
	_, srv, reader := newAuditedService(t, &stubAuth{token: "good"})
	req, err := http.NewRequestWithContext(t.Context(), http.MethodPost, srv.URL+bridgesvc.ResultPath, strings.NewReader(`{"id":"run-1","status":"ok"}`))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Authorization", "Bearer wrong")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", resp.StatusCode)
	}

	row := latestBridgeCommand(t, reader)
	if row.Action != "result" || row.Outcome != "rejected" || row.FailureKind != "unauthorized" {
		t.Errorf("row = %+v, want action=result outcome=rejected failureKind=unauthorized", row)
	}
}

// TestHandleWebhook_Success_RecordsAcceptedRow posts the EXACT body
// shape userdocs/how-to/webhooks.md's own documented curl example
// sends (the seeded webhook workflow's real intake) -- goal 0351 PR2
// item 11's seeded proof that a real webhook POST leaves a
// bridge-command row, through the real handler rather than a synthetic
// call.
func TestHandleWebhook_Success_RecordsAcceptedRow(t *testing.T) {
	auth := &stubAuth{webhookToken: "webhook-secret"}
	svc, srv, reader := newAuditedService(t, auth)
	svc.SetWebhookEventSink(func(values map[string]string, raw []byte) *bridgesvc.WebhookWait { return nil })
	req, err := http.NewRequestWithContext(t.Context(), http.MethodPost, srv.URL+bridgesvc.WebhookPath,
		strings.NewReader(`{"source":"mytool","title":"Build finished","body":"A task completed."}`))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Authorization", "Bearer webhook-secret")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusAccepted {
		t.Fatalf("status = %d, want 202", resp.StatusCode)
	}

	row := latestBridgeCommand(t, reader)
	if row.Action != "webhook" || row.Outcome != "accepted" {
		t.Errorf("row = %+v, want action=webhook outcome=accepted", row)
	}
	if row.Actor.Source != "webhook:webhook-1" {
		t.Errorf("row Actor.Source = %q, want webhook:webhook-1", row.Actor.Source)
	}
	if row.Target.ID != "mytool" {
		t.Errorf("row Target.ID = %q, want mytool (the posted source)", row.Target.ID)
	}
}

// TestHandleWebhook_UnauthorizedToken_RecordsRejectedRowWithFailureKind
// is the seeded webhook workflow's own shape: a curl with a wrong or
// missing bearer token against the real handler leaves exactly one
// rejected bridge-command row -- goal 0351 PR2 item 11's seeded proof.
func TestHandleWebhook_UnauthorizedToken_RecordsRejectedRowWithFailureKind(t *testing.T) {
	auth := &stubAuth{webhookToken: "webhook-secret"}
	_, srv, reader := newAuditedService(t, auth)
	req, err := http.NewRequestWithContext(t.Context(), http.MethodPost, srv.URL+bridgesvc.WebhookPath, strings.NewReader(`{"source":"mytool"}`))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Authorization", "Bearer wrong")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", resp.StatusCode)
	}

	row := latestBridgeCommand(t, reader)
	if row.Action != "webhook" || row.Outcome != "rejected" || row.FailureKind != "unauthorized" {
		t.Errorf("row = %+v, want action=webhook outcome=rejected failureKind=unauthorized", row)
	}
}

func TestReplay_NoBrowserConnected_RecordsRejectedRow(t *testing.T) {
	svc, srv, reader := newAuditedService(t, &stubAuth{token: "good"})
	flow := browserbridge.TestFlow(srv.URL + bridgesvc.TestPagePath)
	_, err := svc.Replay(context.Background(), flow, bridgesvc.ReplayOptions{})
	if err == nil {
		t.Fatal("Replay with no browser connected: want an error")
	}

	row := latestBridgeCommand(t, reader)
	if row.Action != "replay" || row.Outcome != "rejected" {
		t.Errorf("row = %+v, want action=replay outcome=rejected", row)
	}
}

// TestOpenAudit_NotCalled_RecordCommandIsANoop proves the bridge stays
// fully functional (no panic, no error surfaced) with no audit store
// wired -- the same "audit is observability, never a correctness gate"
// contract every other producer's own tests already pin.
func TestOpenAudit_NotCalled_RecordCommandIsANoop(t *testing.T) {
	auth := &stubAuth{token: "minted"}
	svc := bridgesvc.New(auth, slog.New(slog.DiscardHandler))
	req := httptest.NewRequestWithContext(t.Context(), http.MethodPost, bridgesvc.PairPath, strings.NewReader(`{"code":"ABCD2345","label":"Chrome"}`))
	req.RemoteAddr = "127.0.0.1:5555"
	rec := httptest.NewRecorder()
	svc.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("pair status = %d, want 200 (unaffected by no audit store)", rec.Code)
	}
}
