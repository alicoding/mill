package pluginsvc

import "testing"

func TestPluginsReferencing_FindsAnEntityRefSettingHoldingID(t *testing.T) {
	root := t.TempDir()
	writePlugin(t, root, "live-view-like", `{"id":"live-view-like","name":"Live","version":"1","contributes":{"settings":[{"key":"integrationId","type":"entityRef","label":"Integration","description":"d","entityKind":"request"}]}}`, nil)
	writePlugin(t, root, "other", `{"id":"other","name":"Other","version":"1"}`, nil)
	svc := New(root, nil, "1.0.0")
	values := map[string]map[string]string{"live-view-like": {"integrationId": `"req-1"`}}
	svc.readSetting = func(pluginID, key string) (string, bool) {
		v, ok := values[pluginID][key]
		return v, ok
	}

	refs := svc.PluginsReferencing("request", "req-1")
	if len(refs) != 1 || refs[0].PluginID != "live-view-like" || refs[0].SettingKey != "integrationId" || refs[0].Label != "Live" {
		t.Fatalf("PluginsReferencing(match) = %+v", refs)
	}
	if refs := svc.PluginsReferencing("request", "req-2"); len(refs) != 0 {
		t.Fatalf("a non-matching id must find nothing, got %+v", refs)
	}
	if refs := svc.PluginsReferencing("list", "req-1"); len(refs) != 0 {
		t.Fatalf("a mismatched entityKind must find nothing, got %+v", refs)
	}
	if refs := svc.PluginsReferencing("request", ""); refs != nil {
		t.Fatalf("an empty id must find nothing, got %+v", refs)
	}
}

func TestEntityRefEntityKind_ResolvesTheDeclaredSettingOnly(t *testing.T) {
	root := t.TempDir()
	writePlugin(t, root, "live-view-like", `{"id":"live-view-like","name":"Live","version":"1","contributes":{"settings":[
		{"key":"integrationId","type":"entityRef","label":"Integration","description":"d","entityKind":"request"},
		{"key":"flag","type":"boolean","label":"F","description":"d","default":true}
	]}}`, nil)
	svc := New(root, nil, "1.0.0")

	if kind, ok := svc.EntityRefEntityKind("live-view-like", "integrationId"); !ok || kind != "request" {
		t.Fatalf("EntityRefEntityKind(integrationId) = %q, %v", kind, ok)
	}
	if _, ok := svc.EntityRefEntityKind("live-view-like", "flag"); ok {
		t.Fatal("a non-entityRef setting must not resolve")
	}
	if _, ok := svc.EntityRefEntityKind("nope-installed", "integrationId"); ok {
		t.Fatal("an unknown plugin must not resolve")
	}
}
