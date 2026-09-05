package secretsvc

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/alicoding/mill/internal/adapters/clisecrets"
	"github.com/alicoding/mill/internal/adapters/credential"
	"github.com/alicoding/mill/internal/adapters/secretaudit"
	"github.com/alicoding/mill/internal/adapters/secretvault"
	"github.com/alicoding/mill/internal/domain/secret"
	"github.com/alicoding/mill/internal/domain/secretsource"
	"github.com/alicoding/mill/internal/services/servicetest"
)

func envSourceService(t *testing.T) *SecretService {
	t.Helper()
	dir := t.TempDir()
	envPath := filepath.Join(dir, ".env")
	if err := os.WriteFile(envPath, []byte("API_TOKEN=tok-123\nOTHER=x\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	src := secretsource.Source{ID: "proj-env", Label: "Project .env", Kind: secretsource.KindEnv, Path: envPath, UpdatedAt: time.Now()}
	s := NewSecretService(secretvault.New(filepath.Join(dir, "secrets.kdbx")), credential.NewInMemory(), servicetest.NewFakeStore())
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
	s := NewSecretService(secretvault.New(filepath.Join(dir, "secrets.kdbx")), credential.NewInMemory(), servicetest.NewFakeStore())
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

// A CLI source lists the tool's titles under the source's label and
// resolves through the tool at use time; a tool that answers an error
// contributes nothing and the source's row states why.
func TestCLISources_ListResolveAndProblems(t *testing.T) {
	dir := t.TempDir()
	op := secretsource.Source{ID: "work-op", Label: "Work 1Password", Kind: secretsource.KindOnePassword, Path: "Work", UpdatedAt: time.Now()}
	bw := secretsource.Source{ID: "my-bw", Label: "Bitwarden", Kind: secretsource.KindBitwarden, UpdatedAt: time.Now()}
	s := NewSecretService(secretvault.New(filepath.Join(dir, "secrets.kdbx")), credential.NewInMemory(), servicetest.NewFakeStore())
	t.Cleanup(s.stopAutoLock)
	s.SetSourcesLister(func() []secretsource.Source { return []secretsource.Source{op, bw} })
	prevEntries, prevResolve := cliEntries, cliResolve
	t.Cleanup(func() { cliEntries, cliResolve = prevEntries, prevResolve })
	cliEntries = func(src secretsource.Source) ([]clisecrets.Entry, error) {
		if src.Kind == secretsource.KindBitwarden {
			return nil, errors.New("bw: locked -- unlock with `bw unlock`")
		}
		return []clisecrets.Entry{{ID: "Work/abc", Title: "Jira PAT — Work"}}, nil
	}
	cliResolve = func(src secretsource.Source, id string) (string, error) {
		if src.Kind == secretsource.KindOnePassword && id == "Work/abc" {
			return "pat-value", nil
		}
		return "", errors.New("unexpected")
	}
	list, err := s.ListProviderSecrets()
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 1 || list[0].ID != "op:work-op/Work/abc" || list[0].Title != "Jira PAT — Work — Work 1Password" {
		t.Fatalf("list = %+v", list)
	}
	v, err := s.ResolveSecretValue("op:work-op/Work/abc", secretaudit.AccessContext{Context: secretaudit.ContextExecEnv, Actor: "test"})
	if err != nil || v != "pat-value" {
		t.Fatalf("resolve = %q err=%v", v, err)
	}
	problems := s.SourceProblems()
	if problems["my-bw"] == "" || !strings.Contains(problems["my-bw"], "locked") || problems["work-op"] != "" {
		t.Fatalf("problems = %v", problems)
	}
}

// A source-backed vault entry (goal 0306) holds no value: resolving it
// reads the source at that moment through the provider port, and the
// audit line names the source that answered, not the entry.
func TestResolveSecretValue_SourceBackedEntry_ReadsTheSourceAtUseTime(t *testing.T) {
	s := envSourceService(t)
	if err := s.SetupVault(); err != nil {
		t.Fatalf("SetupVault: %v", err)
	}
	created, err := s.CreateSecret("Project API token", "", "", "", "", nil, string(secret.KindText), "env:proj-env/API_TOKEN", nil)
	if err != nil {
		t.Fatalf("CreateSecret: %v", err)
	}
	if created.Password != "" {
		t.Errorf("source-backed entry stored a value (%q), want the value left in the source", created.Password)
	}

	actx := secretaudit.AccessContext{Context: secretaudit.ContextIntegrationAuth}
	got, err := s.ResolveSecretValue(created.ID, actx)
	if err != nil {
		t.Fatalf("ResolveSecretValue: %v", err)
	}
	if got != "tok-123" {
		t.Errorf("resolved %q, want the source's current value", got)
	}
}

// A source-backed entry whose source no longer holds the key reports
// the problem rather than resolving to nothing.
func TestResolveSecretValue_SourceBackedEntry_MissingKeyReports(t *testing.T) {
	s := envSourceService(t)
	if err := s.SetupVault(); err != nil {
		t.Fatalf("SetupVault: %v", err)
	}
	created, err := s.CreateSecret("Gone", "", "", "", "", nil, string(secret.KindText), "env:proj-env/NOT_THERE", nil)
	if err != nil {
		t.Fatalf("CreateSecret: %v", err)
	}
	if _, err := s.ResolveSecretValue(created.ID, secretaudit.AccessContext{Context: secretaudit.ContextIntegrationAuth}); err == nil {
		t.Fatal("resolving a source-backed entry whose key is gone returned nil error")
	}
}
