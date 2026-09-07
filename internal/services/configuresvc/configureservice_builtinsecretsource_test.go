package configuresvc

import (
	"os"
	"testing"

	"github.com/alicoding/mill/internal/adapters/credential"
	"github.com/alicoding/mill/internal/domain/secretsource"
	"github.com/alicoding/mill/internal/services/compositionsvc"
	"github.com/alicoding/mill/internal/services/servicetest"
)

// The seeded example dotenv source (goal 0367) exists only once a seed
// assets dir is wired -- the fixture lives on disk, so a construction
// pass that precedes the wiring must not seed a row pointing nowhere.
func TestConfigureService_SeededDotenvSourceNeedsAWiredDir(t *testing.T) {
	store := servicetest.NewFakeStore()
	cfg := NewConfigureService(store, compositionsvc.NewCompositionService(store), credential.NewInMemory())
	for _, s := range cfg.SecretSources() {
		t.Fatalf("no seeded source before a seed assets dir is wired, got %q", s.ID)
	}

	dir := t.TempDir()
	cfg.SetSeedAssetsDir(dir)
	sources := cfg.SecretSources()
	if len(sources) != 1 || sources[0].ID != secretsource.ExampleDotenvSourceID || !sources[0].BuiltIn {
		t.Fatalf("sources = %+v", sources)
	}
	content, err := os.ReadFile(sources[0].Path)
	if err != nil {
		t.Fatalf("the seeded source's own file must exist: %v", err)
	}
	if string(content) != secretsource.ExampleDotenvFileContent {
		t.Fatalf("fixture content = %q", content)
	}
	// The row's path is the materialized file, never the domain marker.
	if sources[0].Path == secretsource.DotenvSeedPathMarker {
		t.Fatal("the marker path survived into the seeded row")
	}
}

// Reconciling again reuses the fixture the reader may have edited --
// the example's file is theirs, never rewritten over (goal 0367).
func TestConfigureService_SeededDotenvSourceKeepsTheFixtureTheUserEdited(t *testing.T) {
	store := servicetest.NewFakeStore()
	cfg := NewConfigureService(store, compositionsvc.NewCompositionService(store), credential.NewInMemory())
	dir := t.TempDir()
	cfg.SetSeedAssetsDir(dir)
	sources := cfg.SecretSources()
	if len(sources) != 1 {
		t.Fatalf("sources = %+v", sources)
	}
	if err := os.WriteFile(sources[0].Path, []byte("USER_KEY=their-own\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	cfg.reconcileBuiltInSecretSources()
	content, err := os.ReadFile(cfg.SecretSources()[0].Path)
	if err != nil {
		t.Fatal(err)
	}
	if string(content) != "USER_KEY=their-own\n" {
		t.Fatalf("reconcile rewrote the fixture: %q", content)
	}
}
