package configuresvc

import (
	"testing"

	"github.com/alicoding/mill/internal/domain/secretsource"
)

func TestSecretSources_CRUDRoundTrip(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	created, err := cfg.CreateSecretSource("Project .env", secretsource.KindEnv, "/tmp/proj/.env")
	if err != nil {
		t.Fatal(err)
	}
	if got := cfg.SecretSources(); len(got) != 1 || got[0].ID != created.ID || got[0].Path != "/tmp/proj/.env" {
		t.Fatalf("after create: %+v", got)
	}
	if _, err := cfg.CreateSecretSource("", secretsource.KindEnv, "/x"); err == nil {
		t.Error("a label is required")
	}
	if _, err := cfg.CreateSecretSource("x", secretsource.Kind("browser"), "/x"); err == nil {
		t.Error("unknown kinds are refused")
	}
	updated, err := cfg.UpdateSecretSource(created.ID, "Renamed", secretsource.KindEnv, "/tmp/other/.env")
	if err != nil || updated.Label != "Renamed" || updated.Path != "/tmp/other/.env" {
		t.Fatalf("update: %+v %v", updated, err)
	}
	if err := cfg.DeleteSecretSource(created.ID); err != nil {
		t.Fatal(err)
	}
	if got := cfg.SecretSources(); len(got) != 0 {
		t.Errorf("after delete: %+v", got)
	}
}
