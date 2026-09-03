package pluginsvc

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/alicoding/mill/internal/services/compositionsvc"
	"github.com/alicoding/mill/internal/services/guardrailsvc"
	"github.com/alicoding/mill/internal/services/servicetest"
)

type fakeSecretRefs struct {
	titles   map[string]string
	values   map[string]string
	resolved []string // pluginIDs that resolved, in order
}

func (f *fakeSecretRefs) TitleOf(id string) (string, bool) {
	t, ok := f.titles[id]
	return t, ok
}

func (f *fakeSecretRefs) Resolve(id, pluginID string) (string, error) {
	f.resolved = append(f.resolved, pluginID)
	v, ok := f.values[id]
	if !ok {
		return "", fmt.Errorf("no such entry %q", id)
	}
	return v, nil
}

const testerManifestJSON = `{"id":"tester","name":"T","version":"1","capabilities":["fetch"],
 "contributes":{"network":[{"host":"%s","methods":["GET","POST"]}],
 "settings":[{"key":"auth","type":"secretRef","label":"Authorization","description":"d"},
             {"key":"mode","type":"string","label":"Mode","default":"x"}]}}`

func newSecretHarness(t *testing.T, host string) (*PluginService, *guardrailsvc.GuardrailService, *fakeSecretRefs, map[string]string) {
	t.Helper()
	root := t.TempDir()
	writePlugin(t, root, "tester", fmt.Sprintf(testerManifestJSON, host), nil)
	store := servicetest.NewFakeStore()
	guard := guardrailsvc.NewGuardrailService(store, compositionsvc.NewCompositionService(store))
	svc := New(root, guard, "1.0.0")
	refs := &fakeSecretRefs{titles: map[string]string{"vault-1": "Jira PAT"}, values: map[string]string{"vault-1": "s3cr3t-token-value"}}
	settings := map[string]string{}
	svc.WireSecretRefs(refs, func(pluginID, key string) (string, bool) {
		v, ok := settings[pluginID+"/"+key]
		return v, ok
	})
	return svc, guard, refs, settings
}

// approveNextPending waits for the fetch to park and approves it --
// the seeded "an extension sends a stored secret" rule parks every
// secret-carrying fetch, which is exactly the property the first
// assertion pins.
func approveNextPending(t *testing.T, guard *guardrailsvc.GuardrailService) guardrailsvc.PendingGuardedAction {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if pending := guard.PendingGuardedActions(); len(pending) > 0 {
			if err := guard.ResolveGuardedAction(pending[0].ID, true); err != nil {
				t.Fatal(err)
			}
			return pending[0]
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("the secret-carrying fetch never parked")
	return guardrailsvc.PendingGuardedAction{}
}

// The whole ADR-0048 contract in one round trip: the request parks
// naming the secret's title, the header reaches the server with the
// value the plugin never saw, the audit resolve is attributed to the
// plugin, and the value is scrubbed from the response.
func TestFetchForPlugin_SecretIsAttachedHostSideAndRedacted(t *testing.T) {
	var gotAuth string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		w.Header().Set("X-Echo", gotAuth)
		_, _ = fmt.Fprintf(w, `{"echo":%q}`, gotAuth)
	}))
	defer srv.Close()
	host := strings.TrimPrefix(srv.URL, "http://")
	svc, guard, refs, settings := newSecretHarness(t, host)
	settings["tester/auth"] = `"vault-1"`

	type result struct {
		out PluginFetchResult
		err error
	}
	done := make(chan result, 1)
	go func() {
		out, err := svc.FetchForPlugin("tester", PluginFetchRequest{URL: srv.URL + "/x", Secret: &PluginFetchSecret{SettingKey: "auth"}})
		done <- result{out, err}
	}()
	parked := approveNextPending(t, guard)
	if parked.Attributes["secret"] != "Jira PAT" {
		t.Errorf("parked attributes secret = %q, want the entry title", parked.Attributes["secret"])
	}
	if !strings.Contains(parked.Description, "uses secret") || !strings.Contains(parked.Description, "Jira PAT") {
		t.Errorf("parked description = %q, want it to name the secret", parked.Description)
	}
	r := <-done
	if r.err != nil {
		t.Fatalf("FetchForPlugin: %v", r.err)
	}
	if gotAuth != "Bearer s3cr3t-token-value" {
		t.Errorf("server saw Authorization %q, want the injected bearer token", gotAuth)
	}
	if strings.Contains(r.out.Body, "s3cr3t") || strings.Contains(r.out.Headers["X-Echo"], "s3cr3t") {
		t.Errorf("the value leaked back to the plugin: body %q headers %v", r.out.Body, r.out.Headers)
	}
	if !strings.Contains(r.out.Body, "[redacted]") {
		t.Errorf("body = %q, want the redaction placeholder", r.out.Body)
	}
	if len(refs.resolved) != 1 || refs.resolved[0] != "tester" {
		t.Errorf("resolved by %v, want exactly the plugin once", refs.resolved)
	}
}

// A custom header/prefix, and a plugin-typed header of the same name
// giving way to the vault's.
func TestFetchForPlugin_SecretHeaderAndPrefixFollowTheInit(t *testing.T) {
	var got http.Header
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { got = r.Header.Clone() }))
	defer srv.Close()
	svc, guard, _, settings := newSecretHarness(t, strings.TrimPrefix(srv.URL, "http://"))
	settings["tester/auth"] = `"vault-1"`
	done := make(chan error, 1)
	go func() {
		_, err := svc.FetchForPlugin("tester", PluginFetchRequest{
			URL: srv.URL, Headers: map[string]string{"x-api-key": "typed-by-plugin"},
			Secret: &PluginFetchSecret{SettingKey: "auth", Header: "X-Api-Key", Prefix: ""},
		})
		done <- err
	}()
	approveNextPending(t, guard)
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	if got.Get("X-Api-Key") != "s3cr3t-token-value" {
		t.Errorf("X-Api-Key = %q, want the bare value under the custom header", got.Get("X-Api-Key"))
	}
	if got.Get("Authorization") != "" {
		t.Errorf("Authorization = %q, want none", got.Get("Authorization"))
	}
}

// Every refusal happens before the guardrail: an undeclared or
// non-secretRef setting, nothing picked yet, a deleted entry, and a
// mode with no vault.
func TestFetchForPlugin_SecretRefusalsNeedNoRule(t *testing.T) {
	svc, guard, refs, settings := newSecretHarness(t, "api.example.com")
	cases := []struct{ name, key, stored, want string }{
		{"undeclared", "nope", "", "not a declared secretRef"},
		{"wrong type", "mode", "", "not a declared secretRef"},
		{"unset", "auth", "", "no secret is picked"},
		{"empty", "auth", `""`, "no secret is picked"},
		{"gone", "auth", `"vault-deleted"`, "no longer exists"},
	}
	for _, c := range cases {
		delete(settings, "tester/auth")
		if c.stored != "" {
			settings["tester/"+c.key] = c.stored
		}
		_, err := svc.FetchForPlugin("tester", PluginFetchRequest{URL: "https://api.example.com/x", Secret: &PluginFetchSecret{SettingKey: c.key}})
		if err == nil || !strings.Contains(err.Error(), c.want) {
			t.Errorf("%s: error = %v, want %q", c.name, err, c.want)
		}
		if n := len(guard.PendingGuardedActions()); n != 0 {
			t.Errorf("%s: %d actions parked, want none (refused before the rules)", c.name, n)
		}
	}
	if len(refs.resolved) != 0 {
		t.Errorf("a refused fetch resolved a secret: %v", refs.resolved)
	}
	svc.WireSecretRefs(nil, nil)
	settings["tester/auth"] = `"vault-1"`
	_, err := svc.FetchForPlugin("tester", PluginFetchRequest{URL: "https://api.example.com/x", Secret: &PluginFetchSecret{SettingKey: "auth"}})
	if err == nil || !strings.Contains(err.Error(), "not available") {
		t.Errorf("unwired vault: error = %v, want a refusal", err)
	}
}

func TestListPlugins_ValidatesSecretRefSettings(t *testing.T) {
	root := t.TempDir()
	writePlugin(t, root, "ok", `{"id":"ok","name":"N","version":"1","contributes":{"settings":[{"key":"auth","type":"secretRef","label":"Auth","description":""}]}}`, nil)
	writePlugin(t, root, "with-default", `{"id":"with-default","name":"N","version":"1","contributes":{"settings":[{"key":"auth","type":"secretRef","label":"Auth","default":"x"}]}}`, nil)
	svc := New(root, nil, "1.0.0")
	infos, err := svc.ListPlugins()
	if err != nil {
		t.Fatal(err)
	}
	for _, i := range infos {
		switch i.Manifest.ID {
		case "ok":
			if i.Error != "" {
				t.Errorf("ok should load, got %q", i.Error)
			}
		case "with-default":
			if !strings.Contains(i.Error, "cannot declare a default") {
				t.Errorf("with-default error = %q", i.Error)
			}
		}
	}
}
