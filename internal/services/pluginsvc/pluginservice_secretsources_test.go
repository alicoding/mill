package pluginsvc

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const netrcSecretsJS = `
registerSource('netrc', {
  list: function (ctx) { return ctx.readFile().split('\n') },
  resolve: function (ctx, key) { return key + ':' + ctx.readFile() },
})
`

const folderSecretsJS = `
registerSource('folder', {
  list: function (ctx) { return ctx.listFiles('*.txt') },
  resolve: function (ctx, key) { return ctx.readFile(key) },
  discover: function (ctx) { return [{ path: ctx.path, label: 'Here' }] },
})
`

func sourceManifest(id, extra, capabilities string) string {
	if capabilities == "" {
		capabilities = `["read-file"]`
	}
	return `{"id":"` + id + `","name":"Netrc file","version":"1.0.0","capabilities":` + capabilities +
		`,"contributes":{"secretSources":[` + extra + `]}}`
}

const fileSourceDecl = `{"id":"netrc","label":"Netrc file","path":{"kind":"file","label":"File","placeholder":"~/.netrc","default":"~/.netrc"},"capabilities":["list","resolve"]}`

func TestSecretSourceManifest_FailsClosedOnEveryMalformedDeclaration(t *testing.T) {
	cases := map[string]struct{ manifest, want string }{
		"no read-file capability": {sourceManifest("a", fileSourceDecl, `[]`), `"read-file" capability`},
		"bad id":                  {sourceManifest("a", `{"id":"Not Slug","label":"X","path":{"kind":"none"},"capabilities":["list","resolve"]}`, ""), "lowercase letters"},
		"no label":                {sourceManifest("a", `{"id":"s","label":"","path":{"kind":"none"},"capabilities":["list","resolve"]}`, ""), "needs a label"},
		"long label":              {sourceManifest("a", `{"id":"s","label":"`+strings.Repeat("x", 41)+`","path":{"kind":"none"},"capabilities":["list","resolve"]}`, ""), "40 characters or fewer"},
		"bad path kind":           {sourceManifest("a", `{"id":"s","label":"X","path":{"kind":"socket","label":"L"},"capabilities":["list","resolve"]}`, ""), `must be "file", "folder", or "none"`},
		"no path label":           {sourceManifest("a", `{"id":"s","label":"X","path":{"kind":"file"},"capabilities":["list","resolve"]}`, ""), "needs a path label"},
		"missing resolve":         {sourceManifest("a", `{"id":"s","label":"X","path":{"kind":"none"},"capabilities":["list"]}`, ""), `"list" and "resolve"`},
		"unknown capability":      {sourceManifest("a", `{"id":"s","label":"X","path":{"kind":"none"},"capabilities":["list","resolve","erase"]}`, ""), `must be "list", "resolve"`},
		"discover on a file":      {sourceManifest("a", `{"id":"s","label":"X","path":{"kind":"file","label":"F"},"capabilities":["list","resolve","discover"]}`, ""), `only discover under a "folder"`},
		"declared twice":          {sourceManifest("a", `{"id":"s","label":"X","path":{"kind":"none"},"capabilities":["list","resolve"]},{"id":"s","label":"Y","path":{"kind":"none"},"capabilities":["list","resolve"]}`, ""), "declared twice"},
	}
	for name, tc := range cases {
		root := t.TempDir()
		writePlugin(t, root, "a", tc.manifest, map[string]string{"secrets.js": netrcSecretsJS})
		info := New(root, nil, "1.0.0").resolvePlugin("a")
		if !strings.Contains(info.Error, tc.want) {
			t.Errorf("%s: error = %q, want %q", name, info.Error, tc.want)
		}
	}
}

func TestSecretSourceManifest_ValidDeclarationLoadsAndNeedsItsPack(t *testing.T) {
	root := t.TempDir()
	writePlugin(t, root, "a", sourceManifest("a", fileSourceDecl, ""), map[string]string{"secrets.js": netrcSecretsJS})
	if info := New(root, nil, "1.0.0").resolvePlugin("a"); info.Error != "" {
		t.Fatalf("a valid declaration must load: %q", info.Error)
	}
	bare := t.TempDir()
	writePlugin(t, bare, "a", sourceManifest("a", fileSourceDecl, ""), nil)
	if info := New(bare, nil, "1.0.0").resolvePlugin("a"); !strings.Contains(info.Error, "secrets.js is missing") {
		t.Fatalf("a declared family needs its pack: %q", info.Error)
	}
}

func TestConformSecretSourcePack_BothWays(t *testing.T) {
	root := t.TempDir()
	writePlugin(t, root, "a", sourceManifest("a", fileSourceDecl, ""), map[string]string{"secrets.js": `registerSource('other', { list: function(){return []}, resolve: function(){return ''} })`})
	writeTestIcon(t, filepath.Join(root, "a"))
	joined := strings.Join(ConformDir(filepath.Join(root, "a"), ""), "\n")
	if !strings.Contains(joined, `registers the source "other"`) || !strings.Contains(joined, `declares the secret source "netrc"`) {
		t.Fatalf("problems = %s", joined)
	}

	undeclared := t.TempDir()
	writePlugin(t, undeclared, "a", sourceManifest("a", fileSourceDecl, ""), map[string]string{"secrets.js": `registerSource('netrc', { list: function(){return []}, resolve: function(){return ''}, discover: function(){return []} })`})
	writeTestIcon(t, filepath.Join(undeclared, "a"))
	joined = strings.Join(ConformDir(filepath.Join(undeclared, "a"), ""), "\n")
	if !strings.Contains(joined, `implements "discover"`) {
		t.Fatalf("undeclared discover: %s", joined)
	}
}

func newSourceService(t *testing.T, id, decl, pack string) *PluginService {
	t.Helper()
	root := t.TempDir()
	writePlugin(t, root, id, sourceManifest(id, decl, ""), map[string]string{"secrets.js": pack})
	return New(root, nil, "1.0.0")
}

func TestSecretSourceKinds_ListsRunnableDeclarations(t *testing.T) {
	svc := newSourceService(t, "netrc-secrets", fileSourceDecl, netrcSecretsJS)
	kinds := svc.SecretSourceKinds()
	if len(kinds) != 1 {
		t.Fatalf("kinds = %+v", kinds)
	}
	k := kinds[0]
	if k.Kind != "plugin:netrc-secrets/netrc" || k.Label != "Netrc file" || k.PluginName != "Netrc file" ||
		k.PathKind != "file" || k.PathLabel != "File" || k.PathDefault != "~/.netrc" || k.CanDiscover || k.CanImport {
		t.Fatalf("kind = %+v", k)
	}
	// A plugin the run policy blocks contributes no kind, and its
	// sources report why rather than silently listing nothing.
	svc.SetRunPolicy(func(string, bool) bool { return false })
	if got := svc.SecretSourceKinds(); len(got) != 0 {
		t.Fatalf("a blocked plugin contributes nothing, got %+v", got)
	}
	if got := svc.SourceProblem("plugin:netrc-secrets/netrc"); got != SourceProblemPluginDisabled {
		t.Fatalf("problem = %q", got)
	}
}

func TestSourceProblem_NamesEveryStateWithoutAPlugin(t *testing.T) {
	svc := newSourceService(t, "netrc-secrets", fileSourceDecl, netrcSecretsJS)
	if got := svc.SourceProblem("plugin:netrc-secrets/netrc"); got != "" {
		t.Errorf("a healthy source: %q", got)
	}
	if got := svc.SourceProblem("plugin:not-installed/netrc"); got != SourceProblemPluginMissing {
		t.Errorf("missing plugin: %q", got)
	}
	if got := svc.SourceProblem("plugin:netrc-secrets/gone"); got != SourceProblemPluginMissing {
		t.Errorf("undeclared source: %q", got)
	}
	if got := svc.SourceProblem("env"); !strings.Contains(got, "not a plugin secret source") {
		t.Errorf("a built-in kind: %q", got)
	}
}

// A file-kind source reads exactly the file the user configured: a
// relative name is refused, and nothing above it is reachable.
func TestFileSource_ReadsOnlyItsOwnFile(t *testing.T) {
	svc := newSourceService(t, "netrc-secrets", fileSourceDecl, netrcSecretsJS)
	dir := t.TempDir()
	path := filepath.Join(dir, ".netrc")
	if err := os.WriteFile(path, []byte("a\nb"), 0o600); err != nil {
		t.Fatal(err)
	}
	keys, err := svc.SourceList("plugin:netrc-secrets/netrc", path)
	if err != nil || strings.Join(keys, ",") != "a,b" {
		t.Fatalf("list = %v %v", keys, err)
	}
	escaping := `registerSource('netrc', { list: function (ctx) { return [ctx.readFile('../secrets')] }, resolve: function(){return ''} })`
	svc = newSourceService(t, "netrc-secrets", fileSourceDecl, escaping)
	if _, err := svc.SourceList("plugin:netrc-secrets/netrc", path); err == nil || !strings.Contains(err.Error(), "only the file it is configured with") {
		t.Fatalf("a file source must refuse a relative name: %v", err)
	}
}

const folderSourceDecl = `{"id":"folder","label":"Folder of files","path":{"kind":"folder","label":"Folder","placeholder":"","default":""},"capabilities":["list","resolve","discover"]}`

// A folder-kind source reads and lists under the folder the user
// configured and refuses every path that leaves it.
func TestFolderSource_ConfinedToItsOwnFolder(t *testing.T) {
	svc := newSourceService(t, "folders", folderSourceDecl, folderSecretsJS)
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "one.txt"), []byte("v1"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "two.other"), []byte("v2"), 0o600); err != nil {
		t.Fatal(err)
	}
	kind := "plugin:folders/folder"
	keys, err := svc.SourceList(kind, dir)
	if err != nil || strings.Join(keys, ",") != "one.txt" {
		t.Fatalf("list = %v %v", keys, err)
	}
	if v, err := svc.SourceResolve(kind, dir, "one.txt"); err != nil || v != "v1" {
		t.Fatalf("resolve = %q %v", v, err)
	}
	for _, escape := range []string{"../outside", "/etc/hosts", "sub/../../outside"} {
		if _, err := svc.SourceResolve(kind, dir, escape); err == nil {
			t.Errorf("%q must be refused", escape)
		}
	}
	found, err := svc.SourceDiscover(kind, dir)
	if err != nil || len(found) != 1 || found[0].Label != "Here" {
		t.Fatalf("discover = %+v %v", found, err)
	}
	if _, err := svc.SourceImport(kind, dir, []string{"one.txt"}); err == nil {
		t.Error("a source that declares no import must refuse one")
	}
}

func TestSplitSecretSourceKind(t *testing.T) {
	for _, bad := range []string{"env", "plugin:", "plugin:a", "plugin:A/b", "plugin:a/B", "plugin:a/b/c"} {
		if _, _, ok := splitSecretSourceKind(bad); ok {
			t.Errorf("%q parsed", bad)
		}
	}
	p, s, ok := splitSecretSourceKind(SecretSourceKind("netrc-secrets", "netrc"))
	if !ok || p != "netrc-secrets" || s != "netrc" {
		t.Fatalf("split = %q %q %v", p, s, ok)
	}
}
