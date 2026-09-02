package pluginsvc

import (
	"strings"
	"testing"

	"github.com/alicoding/mill/internal/adapters/osopen"
)

// Every refusal that needs no rule happens before the guardrail is
// consulted -- proven with a nil guardrail (a nil-deref would fail).
func TestFetchForPlugin_RefusesBeforeRules(t *testing.T) {
	root := t.TempDir()
	writePlugin(t, root, "no-cap", `{"id":"no-cap","name":"N","version":"1","contributes":{"network":[{"host":"api.example.com"}]}}`, nil)
	writePlugin(t, root, "getter", `{"id":"getter","name":"G","version":"1","capabilities":["fetch"],"contributes":{"network":[{"host":"api.example.com"},{"host":"hooks.example.com:8443","methods":["post"]}]}}`, nil)
	svc := New(root, nil, "1.0.0")

	cases := []struct{ plugin, method, url, want string }{
		{"no-cap", "GET", "https://api.example.com/x", "does not declare the \"fetch\" capability"},
		{"getter", "GET", "https://other.example.com/x", "contributes.network"},
		{"getter", "POST", "https://api.example.com/x", "contributes.network"},
		{"getter", "GET", "https://hooks.example.com:8443/x", "contributes.network"},
		{"getter", "GET", "file:///etc/passwd", "only http(s)"},
		{"getter", "GET", "https://", "no host"},
	}
	for _, c := range cases {
		_, err := svc.FetchForPlugin(c.plugin, PluginFetchRequest{Method: c.method, URL: c.url})
		if err == nil || !strings.Contains(err.Error(), c.want) {
			t.Errorf("%s %s %s: error = %v, want %q", c.plugin, c.method, c.url, err, c.want)
		}
	}
	// A declared host + method reaches the guardrail -- which is nil here,
	// and that is refused too rather than performed unguarded.
	_, err := svc.FetchForPlugin("getter", PluginFetchRequest{Method: "post", URL: "https://hooks.example.com:8443/x"})
	if err == nil || !strings.Contains(err.Error(), "guardrail unavailable") {
		t.Errorf("declared fetch without a guardrail must be refused, got %v", err)
	}
}

func TestListPlugins_ValidatesContributedNetwork(t *testing.T) {
	root := t.TempDir()
	writePlugin(t, root, "net-ok", `{"id":"net-ok","name":"N","version":"1","capabilities":["fetch"],"contributes":{"network":[{"host":"api.example.com","methods":["GET","POST"]},{"host":"localhost:8080"}]}}`, nil)
	writePlugin(t, root, "bad-host", `{"id":"bad-host","name":"N","version":"1","contributes":{"network":[{"host":"https://api.example.com"}]}}`, nil)
	writePlugin(t, root, "bad-method", `{"id":"bad-method","name":"N","version":"1","contributes":{"network":[{"host":"api.example.com","methods":["FETCH"]}]}}`, nil)
	svc := New(root, nil, "1.0.0")
	infos, err := svc.ListPlugins()
	if err != nil {
		t.Fatal(err)
	}
	byID := map[string]PluginInfo{}
	for _, i := range infos {
		byID[i.Manifest.ID] = i
	}
	if got := byID["net-ok"]; got.Error != "" {
		t.Errorf("net-ok should load, got %q", got.Error)
	}
	if got := byID["bad-host"]; !strings.Contains(got.Error, "network host") {
		t.Errorf("bad-host error = %q", got.Error)
	}
	if got := byID["bad-method"]; !strings.Contains(got.Error, "unknown method") {
		t.Errorf("bad-method error = %q", got.Error)
	}
}

func TestNetworkAllows(t *testing.T) {
	entries := []NetworkContribution{{Host: "a.example.com"}, {Host: "b.example.com", Methods: []string{"post", "DELETE"}}}
	if !networkAllows(entries, "a.example.com", "GET") || networkAllows(entries, "a.example.com", "POST") {
		t.Error("an entry without methods is GET only")
	}
	if !networkAllows(entries, "b.example.com", "POST") || !networkAllows(entries, "b.example.com", "DELETE") || networkAllows(entries, "b.example.com", "GET") {
		t.Error("declared methods are matched case-insensitively and exclusively")
	}
	if networkAllows(entries, "c.example.com", "GET") {
		t.Error("an undeclared host never matches")
	}
}

// An approved open-url in server mode is approved-but-not-performed,
// never an error and never a real browser: the adapter's server no-op
// maps to performed=false (the leak this pins was e2e runs opening
// example.com on the developer's machine).
func TestPerform_OpenURLServerModeIsNotPerformed(t *testing.T) {
	svc := New(t.TempDir(), nil, "1.0.0")
	svc.openURL = func(string) error { return osopen.ErrUnsupportedInServerMode }
	performed, err := svc.perform("open-url", map[string]string{"url": "https://example.com"})
	if err != nil || performed {
		t.Fatalf("server-mode open = performed %v, err %v; want false, nil", performed, err)
	}
}

func TestListPlugins_ValidatesContributedViews(t *testing.T) {
	root := t.TempDir()
	writePlugin(t, root, "views-ok", `{"id":"views-ok","name":"V","version":"1","contributes":{"views":[{"id":"issues","title":"Issues"},{"id":"queue","title":"Clip queue"}]}}`, nil)
	writePlugin(t, root, "bad-id", `{"id":"bad-id","name":"V","version":"1","contributes":{"views":[{"id":"Not Slug","title":"X"}]}}`, nil)
	writePlugin(t, root, "no-title", `{"id":"no-title","name":"V","version":"1","contributes":{"views":[{"id":"a","title":" "}]}}`, nil)
	writePlugin(t, root, "dup", `{"id":"dup","name":"V","version":"1","contributes":{"views":[{"id":"a","title":"A"},{"id":"a","title":"B"}]}}`, nil)
	svc := New(root, nil, "1.0.0")
	infos, err := svc.ListPlugins()
	if err != nil {
		t.Fatal(err)
	}
	byID := map[string]PluginInfo{}
	for _, i := range infos {
		byID[i.Manifest.ID] = i
	}
	if got := byID["views-ok"]; got.Error != "" || len(got.Manifest.Contributes.Views) != 2 {
		t.Errorf("views-ok: %q %+v", got.Error, got.Manifest.Contributes.Views)
	}
	for id, want := range map[string]string{"bad-id": "view id", "no-title": "needs a title", "dup": "declared twice"} {
		if got := byID[id]; !strings.Contains(got.Error, want) {
			t.Errorf("%s error = %q, want %q", id, got.Error, want)
		}
	}
}
