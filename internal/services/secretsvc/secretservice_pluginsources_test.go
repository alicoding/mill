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
	"github.com/alicoding/mill/internal/services/pluginsvc"
	"github.com/alicoding/mill/internal/services/servicetest"
)

// The plugin-source port end to end through the real stack: the shipped
// Netrc example is installed into a plugins root, a source of its kind
// points at a real .netrc file, and the same provider path every
// built-in source takes lists its keys and resolves one value.
// pluginsvc is imported HERE only -- the service itself depends on the
// bridge interface, never on the plugin platform.

const netrcExampleID = "netrc-secrets"

func netrcService(t *testing.T) *SecretService {
	t.Helper()
	root := t.TempDir()
	installExample(t, netrcExampleID, root)
	netrcPath := filepath.Join(t.TempDir(), ".netrc")
	body := "machine api.example.com\n  login alice\n  password s3cret-netrc\n\ndefault\n  login bob\n  password fallback-pw\n"
	if err := os.WriteFile(netrcPath, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	src := secretsource.Source{
		ID: "my-netrc", Label: "My netrc",
		Kind: secretsource.Kind(pluginsvc.SecretSourceKind(netrcExampleID, "netrc")),
		Path: netrcPath, UpdatedAt: time.Now(),
	}
	if err := secretsource.Validate(src); err != nil {
		t.Fatalf("a plugin kind must be a valid source: %v", err)
	}
	dir := t.TempDir()
	s := NewSecretService(secretvault.New(filepath.Join(dir, "secrets.kdbx")), credential.NewInMemory(), servicetest.NewFakeStore())
	t.Cleanup(s.stopAutoLock)
	s.SetSourcesLister(func() []secretsource.Source { return []secretsource.Source{src} })
	s.SetPluginSources(pluginsvc.New(root, nil, "99.0.0"))
	return s
}

// installExample copies one shipped example plugin folder into a
// plugins root -- the same folder a user copies in by hand.
func installExample(t *testing.T, id, root string) {
	t.Helper()
	from := filepath.Join("..", "..", "..", "examples", "plugins", id)
	entries, err := os.ReadDir(from)
	if err != nil {
		t.Fatal(err)
	}
	to := filepath.Join(root, id)
	if err := os.MkdirAll(to, 0o750); err != nil {
		t.Fatal(err)
	}
	for _, e := range entries {
		raw, err := os.ReadFile(filepath.Join(from, e.Name())) // #nosec G304 -- a fixed path under this repository's own examples
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(to, e.Name()), raw, 0o600); err != nil { // #nosec G703 -- a name read out of this repository's own examples folder, joined onto a t.TempDir()
			t.Fatal(err)
		}
	}
}

func TestPluginSource_ListsItsKeysByTitle_NeverAValue(t *testing.T) {
	s := netrcService(t)
	list, err := s.ListProviderSecrets()
	if err != nil {
		t.Fatal(err)
	}
	titles := make([]string, 0, len(list))
	for _, e := range list {
		titles = append(titles, e.Title)
		if strings.Contains(e.Title, "s3cret-netrc") || strings.Contains(e.ID, "s3cret-netrc") {
			t.Fatalf("a value leaked into the listing: %+v", e)
		}
	}
	want := "api.example.com/login — My netrc,api.example.com/password — My netrc,default/login — My netrc,default/password — My netrc"
	if strings.Join(titles, ",") != want {
		t.Fatalf("titles = %v", titles)
	}
	if list[0].ID != "plugin:my-netrc/api.example.com/login" {
		t.Fatalf("reference = %q", list[0].ID)
	}
	if problems := s.SourceProblems(); len(problems) != 0 {
		t.Fatalf("a healthy plugin source has no problem: %v", problems)
	}
}

func TestPluginSource_ResolvesThroughTheProviderPath(t *testing.T) {
	s := netrcService(t)
	actx := secretaudit.AccessContext{Context: secretaudit.ContextHTTPHeader}
	v, err := s.ResolveSecretValue("plugin:my-netrc/api.example.com/password", actx)
	if err != nil || v != "s3cret-netrc" {
		t.Fatalf("resolve: %q %v", v, err)
	}
	if _, err := s.ResolveSecretValue("plugin:my-netrc/nope/password", actx); err == nil {
		t.Error("an unknown key must not resolve")
	}
	if _, err := s.ResolveSecretValue("plugin:unknown-source/a/login", actx); err == nil || !strings.Contains(err.Error(), "not configured") {
		t.Errorf("unknown source: %v", err)
	}
}

// A source-backed vault entry is the reference a field actually holds:
// it resolves through the plugin source while the vault is open, and
// the vault's own gate refuses it while the vault is locked -- the
// extension is never a way around the lock.
func TestPluginSource_SourceBackedEntry_RefusedWhileLocked(t *testing.T) {
	s := netrcService(t)
	if err := s.SetupVault(); err != nil {
		t.Fatal(err)
	}
	created, err := s.CreateSecret("Example API password", "alice", "", "", "", "", "text", "plugin:my-netrc/api.example.com/password")
	if err != nil {
		t.Fatal(err)
	}
	actx := secretaudit.AccessContext{Context: secretaudit.ContextHTTPHeader}
	v, err := s.ResolveSecretValue(created.ID, actx)
	if err != nil || v != "s3cret-netrc" {
		t.Fatalf("source-backed resolve: %q %v", v, err)
	}
	s.LockVault()
	if _, err := s.ResolveSecretValue(created.ID, actx); err == nil {
		t.Fatal("a locked vault must refuse a source-backed entry")
	}
}

func TestPluginSource_ProblemStatesWhyWhenTheExtensionIsGone(t *testing.T) {
	dir := t.TempDir()
	src := secretsource.Source{ID: "orphan", Label: "Orphan", Kind: secretsource.Kind(pluginsvc.SecretSourceKind("not-installed", "netrc")), Path: "/tmp/x"}
	s := NewSecretService(secretvault.New(filepath.Join(dir, "secrets.kdbx")), credential.NewInMemory(), servicetest.NewFakeStore())
	t.Cleanup(s.stopAutoLock)
	s.SetSourcesLister(func() []secretsource.Source { return []secretsource.Source{src} })
	s.SetPluginSources(pluginsvc.New(t.TempDir(), nil, "99.0.0"))
	if got := s.SourceProblems()["orphan"]; got != pluginsvc.SourceProblemPluginMissing {
		t.Fatalf("problem = %q", got)
	}
	if list, _ := s.ListProviderSecrets(); len(list) != 0 {
		t.Fatalf("an orphaned source lists nothing, got %v", list)
	}
}

// The two problem codes are copied rather than imported so the service
// keeps no dependency on the plugin platform; this pins the copies.
func TestPluginSourceProblemCodes_MatchThePlatform(t *testing.T) {
	if pluginsvcProblemMissing != pluginsvc.SourceProblemPluginMissing {
		t.Fatalf("missing code drifted: %q vs %q", pluginsvcProblemMissing, pluginsvc.SourceProblemPluginMissing)
	}
}
