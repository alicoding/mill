package configuresvc

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/alicoding/mill/internal/domain/secretsource"
)

// TestExportImportSecretSource_KnownID_UpdatesInPlace pins ADR-0036
// decision 3's update path for a secret source's own definition.
func TestExportImportSecretSource_KnownID_UpdatesInPlace(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	created, err := cfg.CreateSecretSource("Project .env", secretsource.KindEnv, "/tmp/proj/.env")
	if err != nil {
		t.Fatalf("CreateSecretSource: %v", err)
	}

	exported, err := cfg.ExportSecretSource(created.ID)
	if err != nil {
		t.Fatalf("ExportSecretSource: %v", err)
	}
	var raw map[string]any
	if err := json.Unmarshal([]byte(exported), &raw); err != nil {
		t.Fatalf("exported output is not valid JSON: %v", err)
	}
	if got, _ := raw["id"].(string); got != created.ID {
		t.Errorf("exported id = %q, want %q", got, created.ID)
	}
	if _, hasValue := raw["value"]; hasValue {
		t.Fatalf("exported secret source carries a value field: %s", exported)
	}

	imported, err := cfg.ImportSecretSource(exported)
	if err != nil {
		t.Fatalf("ImportSecretSource: %v", err)
	}
	if imported.ID != created.ID {
		t.Errorf("ImportSecretSource.ID = %q, want the same id %q (update in place)", imported.ID, created.ID)
	}
	if imported.Label != created.Label || imported.Kind != created.Kind || imported.Path != created.Path {
		t.Errorf("imported = %+v, want matching Label/Kind/Path from %+v", imported, created)
	}
}

// TestExportImportSecretSource_NoID_CreatesFresh covers decision 3's
// fresh-create path: an id-less payload mints a new source.
func TestExportImportSecretSource_NoID_CreatesFresh(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	created, err := cfg.CreateSecretSource("Project .env", secretsource.KindEnv, "/tmp/proj/.env")
	if err != nil {
		t.Fatalf("CreateSecretSource: %v", err)
	}
	exported, err := cfg.ExportSecretSource(created.ID)
	if err != nil {
		t.Fatalf("ExportSecretSource: %v", err)
	}

	imported, err := cfg.ImportSecretSource(stripIDField(t, exported))
	if err != nil {
		t.Fatalf("ImportSecretSource: %v", err)
	}
	if imported.ID == created.ID {
		t.Errorf("ImportSecretSource.ID = %q, want a fresh id, not the original", imported.ID)
	}
	if len(cfg.SecretSources()) != 2 {
		t.Errorf("SecretSources() = %+v, want both the original and the freshly imported copy", cfg.SecretSources())
	}
}

// TestImportSecretSource_MissingPath_LandsWithAProblemNeverAnImportError
// pins decision 6: an exported source whose path this machine doesn't
// have is never rejected on import -- it lands, and its own problem
// surfaces through secretsvc.SourceProblems, the same "file can't be
// found" state a source whose file later moves already produces.
func TestImportSecretSource_MissingPath_LandsWithAProblemNeverAnImportError(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	doc := `{"schema":"mill://schema/secretsource/v1","label":"Someone else's .env","kind":"env","path":"/does/not/exist/on/this/machine/.env"}`

	imported, err := cfg.ImportSecretSource(doc)
	if err != nil {
		t.Fatalf("ImportSecretSource of a source with an unreachable path must not error, got: %v", err)
	}
	if imported.Label != "Someone else's .env" || imported.Path != "/does/not/exist/on/this/machine/.env" {
		t.Errorf("imported = %+v", imported)
	}
}

func TestExportSecretSource_UnknownID_Rejected(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	if _, err := cfg.ExportSecretSource("nope"); err == nil {
		t.Error("exporting an unknown id must fail")
	}
}

func TestImportSecretSource_InvalidJSON_Rejected(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	if _, err := cfg.ImportSecretSource("not json"); err == nil {
		t.Error("invalid JSON must be rejected")
	}
}

func TestImportSecretSource_UnknownLabel_Rejected(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	if _, err := cfg.ImportSecretSource(`{"schema":"mill://schema/secretsource/v1","kind":"env","path":"/tmp/.env"}`); err == nil {
		t.Error("a label is required, same as CreateSecretSource")
	}
}

// TestExportSecretSource_IsDeterministic mirrors
// TestExportList_IsDeterministic's own reasoning: two exports of the
// same, unchanged source produce byte-identical JSON.
func TestExportSecretSource_IsDeterministic(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	created, err := cfg.CreateSecretSource("Project .env", secretsource.KindEnv, "/tmp/proj/.env")
	if err != nil {
		t.Fatal(err)
	}
	a, err := cfg.ExportSecretSource(created.ID)
	if err != nil {
		t.Fatal(err)
	}
	b, err := cfg.ExportSecretSource(created.ID)
	if err != nil {
		t.Fatal(err)
	}
	if a != b {
		t.Errorf("export is not deterministic:\n%s\nvs\n%s", a, b)
	}
	if strings.Contains(a, "\"BuiltIn\"") {
		t.Errorf("exported secret source leaks the BuiltIn bookkeeping field: %s", a)
	}
}
