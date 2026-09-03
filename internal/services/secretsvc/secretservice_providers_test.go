package secretsvc

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/alicoding/mill/internal/adapters/credential"
	"github.com/alicoding/mill/internal/adapters/secretaudit"
	"github.com/alicoding/mill/internal/adapters/secretvault"
	"github.com/alicoding/mill/internal/domain/secretsource"
)

func envSourceService(t *testing.T) *SecretService {
	t.Helper()
	dir := t.TempDir()
	envPath := filepath.Join(dir, ".env")
	if err := os.WriteFile(envPath, []byte("API_TOKEN=tok-123\nOTHER=x\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	src := secretsource.Source{ID: "proj-env", Label: "Project .env", Kind: secretsource.KindEnv, Path: envPath, UpdatedAt: time.Now()}
	s := NewSecretService(secretvault.New(filepath.Join(dir, "secrets.kdbx")), credential.NewInMemory())
	t.Cleanup(s.stopAutoLock)
	s.SetSourcesLister(func() []secretsource.Source { return []secretsource.Source{src} })
	return s
}

func TestListProviderSecrets_TitlesNameKeyAndSource_NeverValues(t *testing.T) {
	s := envSourceService(t)
	list, err := s.ListProviderSecrets()
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 2 || list[0].ID != "env:proj-env/API_TOKEN" || list[0].Title != "API_TOKEN — Project .env" {
		t.Errorf("list: %+v", list)
	}
	for _, e := range list {
		if strings.Contains(e.Title, "tok-123") {
			t.Error("a value leaked into a title")
		}
	}
}

func TestResolveSecretValue_ProviderQualifiedIDReadsTheDotenvKey(t *testing.T) {
	s := envSourceService(t)
	actx := secretaudit.AccessContext{Context: secretaudit.ContextHTTPHeader}
	v, err := s.ResolveSecretValue("env:proj-env/API_TOKEN", actx)
	if err != nil || v != "tok-123" {
		t.Fatalf("resolve: %q %v", v, err)
	}
	if _, err := s.ResolveSecretValue("env:proj-env/NOPE", actx); err == nil || !strings.Contains(err.Error(), `no key "NOPE"`) {
		t.Errorf("missing key: %v", err)
	}
	if _, err := s.ResolveSecretValue("env:unknown/API_TOKEN", actx); err == nil || !strings.Contains(err.Error(), "not configured") {
		t.Errorf("unknown source: %v", err)
	}
	// A bare id is the vault's, never a provider's: it reaches the
	// (locked) vault and fails there, not in the provider path.
	if _, err := s.ResolveSecretValue("some-vault-id", actx); err == nil || strings.Contains(err.Error(), "secret source") {
		t.Errorf("bare id must go to the vault: %v", err)
	}
}

func brunoSourceService(t *testing.T) (*SecretService, string) {
	t.Helper()
	dir := t.TempDir()
	must := func(name, content string) {
		t.Helper()
		if err := os.MkdirAll(filepath.Dir(filepath.Join(dir, name)), 0o750); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, name), []byte(content), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	must("bruno.json", `{"name":"Gazette","version":"1","type":"collection"}`)
	must(".env", "API_TOKEN=tok-bruno\n")
	must("environments/dev.bru", "vars:secret [ API_TOKEN, SIGNING_KEY ]\n")
	src := secretsource.Source{ID: "gazette", Label: "Gazette collection", Kind: secretsource.KindBruno, Path: dir, UpdatedAt: time.Now()}
	s := NewSecretService(secretvault.New(filepath.Join(dir, "secrets.kdbx")), credential.NewInMemory())
	t.Cleanup(s.stopAutoLock)
	s.SetSourcesLister(func() []secretsource.Source { return []secretsource.Source{src} })
	return s, dir
}

// A Bruno source lists the .env's keys AND every name its environments
// declare as secret, labelled by the collection's own name; a declared
// name the .env lacks resolves to a stated error, never an empty value.
func TestBrunoSource_ListsDeclaredAndEnvKeys_ResolvesFromEnv(t *testing.T) {
	s, _ := brunoSourceService(t)
	list, err := s.ListProviderSecrets()
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 2 || list[0].ID != "bruno:gazette/API_TOKEN" || list[0].Title != "API_TOKEN — Gazette" || list[1].ID != "bruno:gazette/SIGNING_KEY" {
		t.Fatalf("list = %+v", list)
	}
	v, err := s.ResolveSecretValue("bruno:gazette/API_TOKEN", secretaudit.AccessContext{Context: secretaudit.ContextExecEnv, Actor: "test"})
	if err != nil || v != "tok-bruno" {
		t.Fatalf("resolve = %q err=%v", v, err)
	}
	if _, err := s.ResolveSecretValue("bruno:gazette/SIGNING_KEY", secretaudit.AccessContext{Context: secretaudit.ContextExecEnv, Actor: "test"}); err == nil || !strings.Contains(err.Error(), "no key") {
		t.Fatalf("missing declared secret err = %v", err)
	}
	// An env-provider id never reaches a Bruno source.
	if _, err := s.ResolveSecretValue("env:gazette/API_TOKEN", secretaudit.AccessContext{Context: secretaudit.ContextExecEnv, Actor: "test"}); err == nil {
		t.Fatal("an env id resolved through a Bruno source")
	}
}
