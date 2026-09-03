package wiring

import (
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/alicoding/mill/internal/services/atlassvc"
	"github.com/alicoding/mill/internal/services/compositionsvc"
	"github.com/alicoding/mill/internal/services/pluginsvc"
	"github.com/alicoding/mill/internal/services/servicetest"
	"github.com/alicoding/mill/internal/services/settingssvc"
	"github.com/alicoding/mill/internal/services/triggersvc"
)

func writeVersionPinnedPlugin(t *testing.T, root string) {
	t.Helper()
	dir := filepath.Join(root, "plugins", "pinned")
	if err := os.MkdirAll(dir, 0o750); err != nil {
		t.Fatal(err)
	}
	manifest := `{"id":"pinned","name":"P","version":"1","minMillVersion":"9.9.9"}`
	for name, content := range map[string]string{"manifest.json": manifest, "main.js": "export function activate() {}"} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(content), 0o600); err != nil {
			t.Fatal(err)
		}
	}
}

// A source build's version constant is the last release, not this
// build's lineage -- minMillVersion enforcement applies only to
// stamped (beta/stable) builds, so a pinned plugin is never refused
// on the freshest possible code (docs/goals/0245).
func TestNewPluginService_SourceChannelSkipsMinVersionEnforcement(t *testing.T) {
	root := t.TempDir()
	writeVersionPinnedPlugin(t, root)
	settingsPath := filepath.Join(root, "settings.json")

	srcInfos, err := NewPluginService(settingsPath, nil, "source", "0.5.0").ListPlugins()
	if err != nil {
		t.Fatal(err)
	}
	if row := pinnedRow(t, srcInfos); row.Error != "" {
		t.Fatalf("source build refused the pinned plugin: %q", row.Error)
	}

	betaInfos, err := NewPluginService(settingsPath, nil, "beta", "0.5.0").ListPlugins()
	if err != nil {
		t.Fatal(err)
	}
	if row := pinnedRow(t, betaInfos); !strings.Contains(row.Error, "needs Mill 9.9.9") {
		t.Fatalf("beta build Error = %q, want the version refusal", row.Error)
	}
}

func pinnedRow(t *testing.T, infos []pluginsvc.PluginInfo) pluginsvc.PluginInfo {
	t.Helper()
	for _, i := range infos {
		if i.Manifest.ID == "pinned" {
			return i
		}
	}
	t.Fatalf("infos = %+v, want a row for the pinned plugin", infos)
	return pluginsvc.PluginInfo{}
}

// The paste chain's claim order: disabled plugins drop out, the
// preferred kind moves first, everything else keeps id order, and an
// unknown preference changes nothing (ADR-0051 slice 2).
func TestOrderPasteClaims(t *testing.T) {
	claims := []pluginsvc.IngestionClaim{
		{PluginID: "mill-archive", Kind: "archive"},
		{PluginID: "mill-bookmark", Kind: "bookmark"},
		{PluginID: "mill-clipper", Kind: "clip"},
	}
	kinds := func(out []atlassvc.PluginPasteClaim) string {
		s := make([]string, 0, len(out))
		for _, c := range out {
			s = append(s, c.Kind)
		}
		return strings.Join(s, ",")
	}
	all := func(pluginsvc.IngestionClaim) bool { return true }
	if got := kinds(orderPasteClaims(claims, all, "")); got != "archive,bookmark,clip" {
		t.Errorf("no preference = %q", got)
	}
	if got := kinds(orderPasteClaims(claims, all, "clip")); got != "clip,archive,bookmark" {
		t.Errorf("preferred clip = %q", got)
	}
	notArchive := func(c pluginsvc.IngestionClaim) bool { return c.PluginID != "mill-archive" }
	if got := kinds(orderPasteClaims(claims, notArchive, "bookmark")); got != "bookmark,clip" {
		t.Errorf("archive may not run, preferred bookmark = %q", got)
	}
	if got := kinds(orderPasteClaims(claims, all, "nobody")); got != "archive,bookmark,clip" {
		t.Errorf("unknown preference = %q", got)
	}
}

// The one run-policy predicate: built-ins always run; an allow-list,
// when set, excludes everything not on it; otherwise a plugin runs when
// enabled AND allowed after review (ADR-0051 §4).
func TestSettingsTrust_MayRun(t *testing.T) {
	set, store := newSettingsForTrust(t)
	trust := settingsTrust{settings: set}
	if trust.mayRun("mill-a", false) {
		t.Fatal("an unreviewed plugin ran")
	}
	if !trust.mayRun("mill-drawing", true) {
		t.Fatal("a built-in was gated")
	}
	if err := set.SetPluginAllowed("mill-a", true); err != nil {
		t.Fatal(err)
	}
	if !trust.mayRun("mill-a", false) {
		t.Fatal("an allowed plugin did not run")
	}
	if err := set.SetExtensionEnabled("mill-a", false); err != nil {
		t.Fatal(err)
	}
	if trust.mayRun("mill-a", false) {
		t.Fatal("a turned-off plugin ran")
	}
	if err := set.SetExtensionEnabled("mill-a", true); err != nil {
		t.Fatal(err)
	}
	if err := set.SetPluginAllowed("mill-b", true); err != nil {
		t.Fatal(err)
	}
	setPluginAllowlist(t, store, `["mill-b"]`)
	if trust.mayRun("mill-a", false) {
		t.Fatal("a plugin off the allow-list ran")
	}
	if !trust.mayRun("mill-b", false) {
		t.Fatal("a listed, allowed plugin did not run")
	}
	if !trust.mayRun("mill-drawing", true) {
		t.Fatal("the allow-list gated a built-in")
	}
	if err := set.SetExtensionEnabled("mill-drawing", false); err != nil {
		t.Fatal(err)
	}
	if trust.mayRun("mill-drawing", true) {
		t.Fatal("a built-in the user turned off ran")
	}
}

func newSettingsForTrust(t *testing.T) (*settingssvc.SettingsService, *servicetest.FakeStore) {
	t.Helper()
	store := servicetest.NewFakeStore()
	comp := compositionsvc.NewCompositionService(store)
	trig := triggersvc.NewTriggerService(comp, slog.Default(), store)
	return settingssvc.NewSettingsService(store, trig, false), store
}

// setPluginAllowlist writes the administrator's policy the way policy
// tooling does -- straight into the settings store, never through a UI.
func setPluginAllowlist(t *testing.T, store *servicetest.FakeStore, raw string) {
	t.Helper()
	if err := store.Set("settings-plugin-allowlist", raw); err != nil {
		t.Fatal(err)
	}
}

// The lock: a plugin allowed at one hash stops running when its files
// change, and runs again once re-allowed at the new hash.
func TestSettingsTrust_LockRevokesChangedPlugins(t *testing.T) {
	set, _ := newSettingsForTrust(t)
	current := "sha256-aaa"
	set.SetPluginHasher(func(id string) (string, string) { return "1.0.0", current })
	trust := settingsTrust{settings: set, hashOf: func(string) string { return current }}
	if err := set.SetPluginAllowed("mill-a", true); err != nil {
		t.Fatal(err)
	}
	if !trust.mayRun("mill-a", false) {
		t.Fatal("allowed plugin did not run")
	}
	if got := set.GetPluginLock()["mill-a"]; got.Hash != "sha256-aaa" || got.Version != "1.0.0" {
		t.Fatalf("lock = %+v", got)
	}
	current = "sha256-bbb"
	if trust.mayRun("mill-a", false) {
		t.Fatal("a changed plugin ran")
	}
	if err := set.SetPluginAllowed("mill-a", true); err != nil {
		t.Fatal(err)
	}
	if !trust.mayRun("mill-a", false) {
		t.Fatal("re-allowed plugin did not run")
	}
	if err := set.SetPluginAllowed("mill-a", false); err != nil {
		t.Fatal(err)
	}
	if _, ok := set.GetPluginLock()["mill-a"]; ok {
		t.Fatal("withdrawing consent kept the lock entry")
	}
}
