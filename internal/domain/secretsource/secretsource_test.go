package secretsource

import "testing"

// The kind vocabulary is open to extensions (goal 0306 S4) without
// losing its shape: a plugin kind names exactly two slug ids, and
// anything else is still refused.
func TestKind_PluginKindsAreWellFormedAndValidate(t *testing.T) {
	pluginID, sourceID, ok := Kind("plugin:netrc-secrets/netrc").PluginIDs()
	if !ok || pluginID != "netrc-secrets" || sourceID != "netrc" {
		t.Fatalf("split = %q %q %v", pluginID, sourceID, ok)
	}
	for _, bad := range []string{"plugin:", "plugin:a", "plugin:a/b/c", "plugin:A/b", "plugin:-a/b", "browser", "env"} {
		if Kind(bad).IsPlugin() {
			t.Errorf("%q must not read as a plugin kind", bad)
		}
	}
	if err := Validate(Source{Label: "Netrc", Kind: "plugin:netrc-secrets/netrc"}); err != nil {
		t.Errorf("a plugin kind must validate with no path: %v", err)
	}
	if err := Validate(Source{Label: "X", Kind: "plugin:bad"}); err == nil {
		t.Error("a malformed plugin kind must be refused")
	}
	if Kind("plugin:netrc-secrets/netrc").NeedsPath() {
		t.Error("a plugin kind's path requirement is the extension's own declaration")
	}
}
