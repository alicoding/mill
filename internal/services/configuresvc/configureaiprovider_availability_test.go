package configuresvc

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/alicoding/mill/internal/adapters/secretaudit"
	"github.com/alicoding/mill/internal/domain/aiprovider"
)

func allowProviderCheck(_ context.Context, _ ProviderCheckPermissionRequest) (aiprovider.PermissionResult, error) {
	return aiprovider.PermissionResult{Status: aiprovider.PermissionAllowed, Source: "allow", RuleID: "allow-inspect"}, nil
}

func waitForProviderReport(t *testing.T, cfg *ConfigureService, id string, want aiprovider.CheckStatus) aiprovider.Report {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		report := cfg.GetAIProviderAvailability(id)
		if report.Lifecycle == want {
			return report
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatalf("provider report never reached %q: %+v", want, cfg.GetAIProviderAvailability(id))
	return aiprovider.Report{}
}

func TestAIProviderCheck_WaitsForPermissionBeforeSecretOrNetworkAndCancels(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	var secretReads, requests atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { requests.Add(1) }))
	defer srv.Close()
	p, err := cfg.CreateAIProvider("Guarded", aiprovider.KindOpenAICompat, srv.URL, "model", "vault:key")
	if err != nil {
		t.Fatal(err)
	}
	cfg.SetSecretResolver(func(string, secretaudit.AccessContext) (string, error) { secretReads.Add(1); return "key-value", nil })
	authorizerExited := make(chan error, 1)
	SetAIProviderCheckAuthorizer(cfg, func(ctx context.Context, request ProviderCheckPermissionRequest) (aiprovider.PermissionResult, error) {
		if request.ProviderID != p.ID || request.CheckID == "" || request.Endpoint != srv.URL+"/v1/models" || request.Actor != "configure" {
			t.Errorf("permission request = %+v", request)
		}
		<-ctx.Done()
		authorizerExited <- ctx.Err()
		// Model an approval result racing with cancellation. The worker must
		// still be current before the coordinator can read the secret.
		return aiprovider.PermissionResult{Status: aiprovider.PermissionAllowed, Source: "allow"}, nil
	})

	started := cfg.StartAIProviderCheck(p.ID)
	if started.Lifecycle != aiprovider.CheckAwaitingApproval || secretReads.Load() != 0 || requests.Load() != 0 {
		t.Fatalf("start=%+v secretReads=%d requests=%d", started, secretReads.Load(), requests.Load())
	}
	cancelled := cfg.CancelAIProviderCheck(p.ID, started.CheckID)
	if cancelled.Lifecycle != aiprovider.CheckCancelled || cancelled.Freshness != aiprovider.FreshnessStale {
		t.Fatalf("cancelled = %+v", cancelled)
	}
	select {
	case err := <-authorizerExited:
		if err != context.Canceled {
			t.Fatalf("authorizer error=%v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("permission wait was not cancelled")
	}
	if secretReads.Load() != 0 || requests.Load() != 0 {
		t.Fatalf("cancel performed secret/network I/O: %d/%d", secretReads.Load(), requests.Load())
	}
}

func TestAIProviderCheck_DenialAndCachedReadsDoNoIO(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	var secretReads, requests atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { requests.Add(1) }))
	defer srv.Close()
	p, err := cfg.CreateAIProvider("Denied", aiprovider.KindAnthropic, srv.URL, "model", "vault:key")
	if err != nil {
		t.Fatal(err)
	}
	cfg.SetSecretResolver(func(string, secretaudit.AccessContext) (string, error) { secretReads.Add(1); return "key-value", nil })
	SetAIProviderCheckAuthorizer(cfg, func(context.Context, ProviderCheckPermissionRequest) (aiprovider.PermissionResult, error) {
		return aiprovider.PermissionResult{Status: aiprovider.PermissionDenied, Source: "deny", RuleID: "deny-inspect"}, nil
	})
	started := cfg.StartAIProviderCheck(p.ID)
	got := waitForProviderReport(t, cfg, p.ID, aiprovider.CheckCompleted)
	for i := 0; i < 5; i++ {
		_ = cfg.GetAIProviderAvailability(p.ID)
		_ = cfg.ListAIProviderAvailability()
	}
	if got.Permission.Status != aiprovider.PermissionDenied || !containsReason(got.ReasonCodes, "permission-denied") || secretReads.Load() != 0 || requests.Load() != 0 {
		t.Fatalf("started=%+v got=%+v reads=%d requests=%d", started, got, secretReads.Load(), requests.Load())
	}
}

func TestAIProviderCheck_ApprovalTimeoutIsReportedWithoutIO(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	var secretReads atomic.Int32
	p, err := cfg.CreateAIProvider("Timed out", aiprovider.KindAnthropic, "https://api.anthropic.com", "model", "vault:key")
	if err != nil {
		t.Fatal(err)
	}
	cfg.SetSecretResolver(func(string, secretaudit.AccessContext) (string, error) {
		secretReads.Add(1)
		return "key-value", nil
	})
	SetAIProviderCheckAuthorizer(cfg, func(context.Context, ProviderCheckPermissionRequest) (aiprovider.PermissionResult, error) {
		return aiprovider.PermissionResult{}, errors.New("guardrail approval timed out")
	})

	started := cfg.StartAIProviderCheck(p.ID)
	got := waitForProviderReport(t, cfg, p.ID, aiprovider.CheckTimedOut)
	if got.CheckID != started.CheckID || got.Freshness != aiprovider.FreshnessStale || !containsReason(got.ReasonCodes, "check-timed-out") || secretReads.Load() != 0 {
		t.Fatalf("started=%+v report=%+v secretReads=%d", started, got, secretReads.Load())
	}
}

func TestAIProviderAvailability_PassiveOperationsDoNoSecretOrNetworkIO(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	var secretReads, requests atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { requests.Add(1) }))
	defer srv.Close()
	p, err := cfg.CreateAIProvider("Passive", aiprovider.KindOpenAICompat, srv.URL, "model", "vault:key")
	if err != nil {
		t.Fatal(err)
	}
	cfg.SetSecretResolver(func(string, secretaudit.AccessContext) (string, error) {
		secretReads.Add(1)
		return "key-value", nil
	})

	_ = cfg.GetAIProviderAvailability(p.ID)
	_ = cfg.ListAIProviderAvailability()
	exported, err := cfg.ExportAIProvider(p.ID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := cfg.UpdateAIProvider(p.ID, p.Label, p.Kind, p.BaseURL, p.Model, p.KeyRef); err != nil {
		t.Fatal(err)
	}
	if _, err := cfg.ImportAIProvider(exported); err != nil {
		t.Fatal(err)
	}
	if secretReads.Load() != 0 || requests.Load() != 0 {
		t.Fatalf("passive operations performed secret/network I/O: %d/%d", secretReads.Load(), requests.Load())
	}
}

func TestAIProviderCheck_NewStartSupersedesPendingApproval(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	p, err := cfg.CreateAIProvider("Superseded", aiprovider.KindOpenAICompat, "http://127.0.0.1:1", "model", "")
	if err != nil {
		t.Fatal(err)
	}
	requests := make(chan ProviderCheckPermissionRequest, 2)
	cancelled := make(chan string, 2)
	SetAIProviderCheckAuthorizer(cfg, func(ctx context.Context, request ProviderCheckPermissionRequest) (aiprovider.PermissionResult, error) {
		requests <- request
		<-ctx.Done()
		cancelled <- request.CheckID
		return aiprovider.PermissionResult{}, ctx.Err()
	})

	first := cfg.StartAIProviderCheck(p.ID)
	<-requests
	second := cfg.StartAIProviderCheck(p.ID)
	if first.CheckID == second.CheckID || first.ConfigRevision != second.ConfigRevision {
		t.Fatalf("first=%+v second=%+v", first, second)
	}
	select {
	case checkID := <-cancelled:
		if checkID != first.CheckID {
			t.Fatalf("cancelled check=%q, want %q", checkID, first.CheckID)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("superseded approval was not cancelled")
	}
	if cached := cfg.GetAIProviderAvailability(p.ID); cached.CheckID != second.CheckID || cached.Lifecycle != aiprovider.CheckAwaitingApproval {
		t.Fatalf("cached second report=%+v", cached)
	}
	_ = cfg.CancelAIProviderCheck(p.ID, second.CheckID)
}

func TestAIProviderCheck_SuccessIsSanitizedAndOperationsRemainUnknown(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	var actor string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer private-value" {
			t.Errorf("Authorization = %q", r.Header.Get("Authorization"))
		}
		_, _ = w.Write([]byte(`{"data":[{"id":"model"}]}`))
	}))
	defer srv.Close()
	p, err := cfg.CreateAIProvider("Working", aiprovider.KindOpenAICompat, srv.URL, "model", "vault:key")
	if err != nil {
		t.Fatal(err)
	}
	cfg.SetSecretResolver(func(id string, actx secretaudit.AccessContext) (string, error) {
		if id != "key" || actx.Context != secretaudit.ContextAIProvider {
			t.Errorf("secret attribution id=%q context=%q", id, actx.Context)
		}
		actor = actx.Actor
		return "private-value", nil
	})
	SetAIProviderCheckAuthorizer(cfg, allowProviderCheck)
	started := StartAIProviderCheckWithActor(cfg, p.ID, "mcp:test-client")
	got := waitForProviderReport(t, cfg, p.ID, aiprovider.CheckCompleted)
	if got.CheckID != started.CheckID || got.Transport != aiprovider.TransportResponded || got.Inspection != aiprovider.InspectionAvailable || got.Authentication != aiprovider.AuthenticationMetadataAuthorized || got.Freshness != aiprovider.FreshnessFresh || got.CheckedAt.IsZero() {
		t.Fatalf("report = %+v", got)
	}
	if got.MachineID == "" || got.SessionID == "" || len(got.Operations) != 3 || actor != "provider-check:"+got.CheckID+":mcp:test-client" {
		t.Fatalf("identity/operations/audit actor: %+v actor=%q", got, actor)
	}
	for _, feature := range got.Operations {
		if feature.Support != aiprovider.SupportUnknown || feature.Evidence != aiprovider.EvidenceProviderMetadata || feature.WireOperation == "" {
			t.Errorf("operation feature = %+v", feature)
		}
	}
	raw, _ := json.Marshal(got)
	text := string(raw)
	for _, forbidden := range []string{"private-value", "vault:key", "Bearer ", "rawBody"} {
		if strings.Contains(text, forbidden) {
			t.Errorf("serialized report leaked %q: %s", forbidden, text)
		}
	}
	exported, err := cfg.ExportAIProvider(p.ID)
	if err != nil {
		t.Fatal(err)
	}
	for _, localEvidence := range []string{got.CheckID, got.MachineID, got.SessionID, string(got.Freshness)} {
		if strings.Contains(exported, localEvidence) {
			t.Errorf("provider export contains machine-local evidence %q: %s", localEvidence, exported)
		}
	}
}

func TestAIProviderCheck_ConfigChangeCancelsAndStaleCompletionCannotWin(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	requestStarted := make(chan struct{})
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { close(requestStarted); <-r.Context().Done() }))
	defer srv.Close()
	p, err := cfg.CreateAIProvider("Changing", aiprovider.KindOpenAICompat, srv.URL, "old-model", "")
	if err != nil {
		t.Fatal(err)
	}
	SetAIProviderCheckAuthorizer(cfg, allowProviderCheck)
	started := cfg.StartAIProviderCheck(p.ID)
	select {
	case <-requestStarted:
	case <-time.After(5 * time.Second):
		t.Fatal("request did not start")
	}
	updated, err := cfg.UpdateAIProvider(p.ID, p.Label, p.Kind, p.BaseURL, "new-model", p.KeyRef)
	if err != nil {
		t.Fatal(err)
	}
	got := cfg.GetAIProviderAvailability(p.ID)
	if got.CheckID != started.CheckID || got.Model != "old-model" || got.Lifecycle != aiprovider.CheckCancelled || got.Freshness != aiprovider.FreshnessStale || !containsReason(got.ReasonCodes, "configuration-changed") {
		t.Fatalf("updated=%+v report=%+v", updated, got)
	}
	time.Sleep(30 * time.Millisecond)
	if after := cfg.GetAIProviderAvailability(p.ID); after.Freshness == aiprovider.FreshnessFresh || after.Model != "old-model" {
		t.Fatalf("stale completion won: %+v", after)
	}
	if fresh := cfg.StartAIProviderCheck(p.ID); fresh.ConfigRevision == started.ConfigRevision || fresh.Model != "new-model" {
		t.Fatalf("new check did not bind new revision: old=%+v new=%+v", started, fresh)
	}
	StopAIProviderChecks(cfg)
}

func TestAIProviderAvailability_CachedApprovalCannotOutliveVisibleConfig(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	var secretReads atomic.Int32
	p, err := cfg.CreateAIProvider("Approval race", aiprovider.KindOpenAICompat, "http://127.0.0.1:1", "old-model", "vault:key")
	if err != nil {
		t.Fatal(err)
	}
	cfg.SetSecretResolver(func(string, secretaudit.AccessContext) (string, error) {
		secretReads.Add(1)
		return "key-value", nil
	})
	approvalResolved := make(chan struct{})
	SetAIProviderCheckAuthorizer(cfg, func(context.Context, ProviderCheckPermissionRequest) (aiprovider.PermissionResult, error) {
		<-approvalResolved
		return aiprovider.PermissionResult{Status: aiprovider.PermissionAllowed, Source: "allow"}, nil
	})
	started := cfg.StartAIProviderCheck(p.ID)

	// Model persistence becoming visible before its mutation callback is the
	// narrow race Get must close on its own.
	cfg.mu.Lock()
	for i := range cfg.aiProviders {
		if cfg.aiProviders[i].ID == p.ID {
			cfg.aiProviders[i].Model = "new-model"
			cfg.aiProviders[i].UpdatedAt = time.Now().Add(time.Second)
		}
	}
	cfg.mu.Unlock()
	got := cfg.GetAIProviderAvailability(p.ID)
	if got.CheckID != started.CheckID || got.Lifecycle != aiprovider.CheckCancelled || got.Freshness != aiprovider.FreshnessStale || !containsReason(got.ReasonCodes, "configuration-changed") {
		t.Fatalf("visible-config race report=%+v", got)
	}
	close(approvalResolved)
	time.Sleep(20 * time.Millisecond)
	if secretReads.Load() != 0 {
		t.Fatalf("superseded approval read %d secrets", secretReads.Load())
	}
}

func TestAIProviderCheck_SecretInvalidationCancelsAllReports(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	p, err := cfg.CreateAIProvider("Secrets", aiprovider.KindOpenAICompat, "http://127.0.0.1:1", "model", "")
	if err != nil {
		t.Fatal(err)
	}
	SetAIProviderCheckAuthorizer(cfg, func(ctx context.Context, _ ProviderCheckPermissionRequest) (aiprovider.PermissionResult, error) {
		<-ctx.Done()
		return aiprovider.PermissionResult{}, ctx.Err()
	})
	started := cfg.StartAIProviderCheck(p.ID)
	InvalidateAIProviderAvailabilityForSecrets(cfg)
	got := cfg.GetAIProviderAvailability(p.ID)
	if got.CheckID != started.CheckID || got.Lifecycle != aiprovider.CheckCancelled || got.Freshness != aiprovider.FreshnessStale || !containsReason(got.ReasonCodes, "secret-source-changed") {
		t.Fatalf("report=%+v", got)
	}
}

func TestAIProviderAvailability_CachedFreshnessIsValidatedAndShutdownRefusesStarts(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"data":[{"id":"model"}]}`))
	}))
	defer srv.Close()
	p, err := cfg.CreateAIProvider("Cached", aiprovider.KindOpenAICompat, srv.URL, "model", "")
	if err != nil {
		t.Fatal(err)
	}
	if initial := cfg.GetAIProviderAvailability(p.ID); initial.Lifecycle != aiprovider.CheckNotStarted || initial.CheckID != "" {
		t.Fatalf("initial report=%+v", initial)
	}
	SetAIProviderCheckAuthorizer(cfg, allowProviderCheck)
	_ = cfg.StartAIProviderCheck(p.ID)
	fresh := waitForProviderReport(t, cfg, p.ID, aiprovider.CheckCompleted)
	if fresh.Freshness != aiprovider.FreshnessFresh {
		t.Fatalf("fresh report=%+v", fresh)
	}

	// Models the narrow window after persistence exposes the new value but
	// before the mutation's invalidation callback runs.
	cfg.mu.Lock()
	for i := range cfg.aiProviders {
		if cfg.aiProviders[i].ID == p.ID {
			cfg.aiProviders[i].Model = "new-model"
			cfg.aiProviders[i].UpdatedAt = time.Now().Add(time.Second)
		}
	}
	cfg.mu.Unlock()
	if got := cfg.GetAIProviderAvailability(p.ID); got.Freshness != aiprovider.FreshnessStale {
		t.Fatalf("Get returned old fresh evidence after visible config change: %+v", got)
	}

	StopAIProviderChecks(cfg)
	stopped := cfg.StartAIProviderCheck(p.ID)
	if stopped.Lifecycle != aiprovider.CheckCancelled || !containsReason(stopped.ReasonCodes, "service-stopped") {
		t.Fatalf("start after shutdown = %+v", stopped)
	}
	cfg.availabilityMu.Lock()
	workers := len(cfg.availabilityWorkers)
	cfg.availabilityMu.Unlock()
	if workers != 0 {
		t.Fatalf("shutdown start registered %d workers", workers)
	}
}

func containsReason(values []string, want string) bool {
	for _, value := range values {
		if value == want {
			return true
		}
	}
	return false
}
