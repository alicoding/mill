package wiring

import (
	"context"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"github.com/alicoding/mill/internal/adapters/credential"
	"github.com/alicoding/mill/internal/domain/aiprovider"
	"github.com/alicoding/mill/internal/services/compositionsvc"
	"github.com/alicoding/mill/internal/services/configuresvc"
	"github.com/alicoding/mill/internal/services/dataevent"
	"github.com/alicoding/mill/internal/services/servicetest"
)

func TestWireSecrets_InvalidatesProviderEvidenceForSecretEvents(t *testing.T) {
	store := servicetest.NewFakeStore()
	comp := compositionsvc.NewCompositionService(store)
	cfg := configuresvc.NewConfigureService(store, comp, credential.NewInMemory())
	dir := t.TempDir()
	secrets := WireSecrets(filepath.Join(dir, "secrets.kdbx"), filepath.Join(dir, "backups"), credential.NewInMemory(), store, cfg)
	t.Cleanup(func() {
		secrets.StopAutoLock()
		secrets.CloseAllSourceWatches()
	})

	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"data":[{"id":"model"}]}`))
	}))
	defer provider.Close()
	p, err := cfg.CreateAIProvider("Wired", aiprovider.KindOpenAICompat, provider.URL, "model", "")
	if err != nil {
		t.Fatal(err)
	}
	configuresvc.SetAIProviderCheckAuthorizer(cfg, func(context.Context, configuresvc.ProviderCheckPermissionRequest) (aiprovider.PermissionResult, error) {
		return aiprovider.PermissionResult{Status: aiprovider.PermissionAllowed, Source: "allow"}, nil
	})

	for _, entity := range []string{"secret", "secretsource"} {
		started := cfg.StartAIProviderCheck(p.ID)
		deadline := time.Now().Add(5 * time.Second)
		for cfg.GetAIProviderAvailability(p.ID).Lifecycle != aiprovider.CheckCompleted && time.Now().Before(deadline) {
			time.Sleep(5 * time.Millisecond)
		}
		if report := cfg.GetAIProviderAvailability(p.ID); report.CheckID != started.CheckID || report.Freshness != aiprovider.FreshnessFresh {
			t.Fatalf("fresh %s report=%+v", entity, report)
		}

		dataevent.Emit(entity, "changed-id")
		if report := cfg.GetAIProviderAvailability(p.ID); report.Freshness != aiprovider.FreshnessStale || !hasReason(report.ReasonCodes, "secret-source-changed") {
			t.Fatalf("%s event report=%+v", entity, report)
		}
	}
}

func hasReason(values []string, want string) bool {
	for _, value := range values {
		if value == want {
			return true
		}
	}
	return false
}
