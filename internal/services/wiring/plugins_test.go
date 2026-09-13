package wiring

import (
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/alicoding/mill/internal/adapters/credential"
	"github.com/alicoding/mill/internal/adapters/secretvault"
	"github.com/alicoding/mill/internal/services/atlassvc"
	"github.com/alicoding/mill/internal/services/compositionsvc"
	"github.com/alicoding/mill/internal/services/pluginsvc"
	"github.com/alicoding/mill/internal/services/secretsvc"
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

	srcInfos, err := NewPluginService(settingsPath, nil, "source", "0.5.0", "", nil).ListPlugins()
	if err != nil {
		t.Fatal(err)
	}
	if row := pinnedRow(t, srcInfos); row.Error != "" {
		t.Fatalf("source build refused the pinned plugin: %q", row.Error)
	}

	betaInfos, err := NewPluginService(settingsPath, nil, "beta", "0.5.0", "", nil).ListPlugins()
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
	trust := settingsTrust{
		settings:               set,
		hashOf:                 func(id string) string { return "sha256-" + id },
		packageApprovalMatches: func(id, hash string, _ pluginsvc.PluginGrant) bool { return hash == "sha256-"+id },
	}
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
	settings := settingssvc.NewSettingsService(store, trig, false)
	var mu sync.Mutex
	var payload []byte
	var revision int64
	settingssvc.SetPluginApprovalStore(settings,
		func() ([]byte, int64, bool, error) {
			mu.Lock()
			defer mu.Unlock()
			return append([]byte(nil), payload...), revision, payload != nil, nil
		},
		func(initializer settingssvc.PluginApprovalInitializer, change settingssvc.PluginApprovalChange) ([]byte, int64, error) {
			mu.Lock()
			defer mu.Unlock()
			current := append([]byte(nil), payload...)
			if current == nil {
				var err error
				current, err = initializer()
				if err != nil {
					return nil, 0, err
				}
			}
			next, err := change(current)
			if err != nil {
				return nil, 0, err
			}
			revision++
			payload = append([]byte(nil), next...)
			return append([]byte(nil), payload...), revision, nil
		},
	)
	settingssvc.WirePluginRemoval(settings, func(_ string, action func(string, bool, bool) error) error {
		return action("/installed/plugin", false, true)
	})
	settings.SetPluginHasher(func(id string) (settingssvc.PluginGrantSnapshot, error) {
		return settingssvc.PluginGrantSnapshot{Version: "1.0.0", Hash: "sha256-" + id, NetworkGrantVersion: 1, NetworkMethods: map[string][]string{}}, nil
	})
	return settings, store
}

func TestWirePluginTrust_GrandfathersExistingPluginThroughMutationPort(t *testing.T) {
	root := t.TempDir()
	dir := filepath.Join(root, "plugins", "existing-plugin")
	if err := os.MkdirAll(dir, 0o750); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "manifest.json"), []byte(`{"id":"existing-plugin","name":"Existing","version":"1.0.0"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "main.js"), []byte("export function activate() {}"), 0o600); err != nil {
		t.Fatal(err)
	}

	store := servicetest.NewFakeStore()
	comp := compositionsvc.NewCompositionService(store)
	trig := triggersvc.NewTriggerService(comp, slog.Default(), store)
	settings := settingssvc.NewSettingsService(store, trig, false)
	plugins := NewPluginService(filepath.Join(root, "settings.json"), nil, "source", "", "", nil)
	secrets := secretsvc.NewSecretService(secretvault.New(filepath.Join(root, "secrets.kdbx")), credential.NewInMemory(), store)

	WirePluginTrust(plugins, settings, secrets)

	if !pluginSettingsTrust(plugins, settings).mayRun("existing-plugin", false) {
		t.Fatal("a plugin present before approval initialization did not retain permission to run")
	}
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
	set.SetPluginHasher(func(id string) (settingssvc.PluginGrantSnapshot, error) {
		return settingssvc.PluginGrantSnapshot{Version: "1.0.0", Hash: current, NetworkGrantVersion: 1, NetworkMethods: map[string][]string{}}, nil
	})
	trust := settingsTrust{settings: set, hashOf: func(string) string { return current }, packageApprovalMatches: func(_ string, hash string, _ pluginsvc.PluginGrant) bool { return hash == current }}
	if err := set.SetPluginAllowed("mill-a", true); err != nil {
		t.Fatal(err)
	}
	if !trust.mayRun("mill-a", false) {
		t.Fatal("allowed plugin did not run")
	}
	locks, err := set.GetPluginLock()
	if err != nil {
		t.Fatal(err)
	}
	if got := locks["mill-a"]; got.Hash != "sha256-aaa" || got.Version != "1.0.0" {
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
	locks, err = set.GetPluginLock()
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := locks["mill-a"]; ok {
		t.Fatal("withdrawing consent kept the lock entry")
	}
}

// WirePluginTrust's real stack keeps MV3's rule end to end, not just
// at the pure settingsTrust level -- a manifest-only edit (narrowing
// OR unrelated) never re-gates, even though the whole-folder
// ContentHash it feeds signing/tiering DOES change; only a widened
// declared set does (docs/goals/0375 S2).
func TestWirePluginTrust_NarrowedOrUnrelatedManifestEditKeepsTheGrant(t *testing.T) {
	root := t.TempDir()
	dir := filepath.Join(root, "plugins", "widen-probe")
	if err := os.MkdirAll(dir, 0o750); err != nil {
		t.Fatal(err)
	}
	manifestPath := filepath.Join(dir, "manifest.json")
	writeManifest := func(t *testing.T, body string) {
		t.Helper()
		if err := os.WriteFile(manifestPath, []byte(body), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	writeManifest(t, `{"id":"widen-probe","name":"W","version":"1.0.0","capabilities":["open-url","write-content"]}`)
	if err := os.WriteFile(filepath.Join(dir, "main.js"), []byte("export function activate() {}"), 0o600); err != nil {
		t.Fatal(err)
	}

	store := servicetest.NewFakeStore()
	comp := compositionsvc.NewCompositionService(store)
	trig := triggersvc.NewTriggerService(comp, slog.Default(), store)
	settings := settingssvc.NewSettingsService(store, trig, false)
	plugins := NewPluginService(filepath.Join(root, "settings.json"), nil, "source", "", "", nil)
	secrets := secretsvc.NewSecretService(secretvault.New(filepath.Join(root, "secrets.kdbx")), credential.NewInMemory(), store)
	WirePluginTrust(plugins, settings, secrets)

	if err := settings.SetPluginAllowed("widen-probe", true); err != nil {
		t.Fatal(err)
	}
	trust := pluginSettingsTrust(plugins, settings)
	if !trust.mayRun("widen-probe", false) {
		t.Fatal("freshly allowed plugin did not run")
	}
	contentHashBefore := plugins.ContentHashOf("widen-probe")

	// Narrow: drop write-content. The whole-folder ContentHash changes
	// (manifest.json is part of it), but the grant did not widen.
	writeManifest(t, `{"id":"widen-probe","name":"W","version":"1.0.0","capabilities":["open-url"]}`)
	if plugins.ContentHashOf("widen-probe") == contentHashBefore {
		t.Fatal("test setup: narrowing must change the folder's ContentHash")
	}
	if !trust.mayRun("widen-probe", false) {
		t.Fatal("a NARROWED manifest re-gated the plugin -- MV3's rule says it must keep running")
	}

	// Widen: add a capability beyond what was ever granted (fetch was
	// never allowed). Now it must re-gate.
	writeManifest(t, `{"id":"widen-probe","name":"W","version":"1.0.0","capabilities":["open-url","fetch"]}`)
	if trust.mayRun("widen-probe", false) {
		t.Fatal("a WIDENED manifest kept running -- it must wait for review again")
	}

	// An unrelated edit -- the name changes, capabilities do not --
	// also never re-gates.
	writeManifest(t, `{"id":"widen-probe","name":"Widen Probe Renamed","version":"1.0.0","capabilities":["open-url"]}`)
	if !trust.mayRun("widen-probe", false) {
		t.Fatal("an unrelated manifest edit re-gated the plugin")
	}
}

// A pre-#806 lock names the whole-folder ContentHash and has no grant
// shape. Transactional migration preserves those historical bytes; the
// runtime validates the unchanged whole package instead of manufacturing a
// current grant, while a genuinely changed package remains denied.
func TestWirePluginTrust_PreservesPreCodeHashLockFormat(t *testing.T) {
	root := t.TempDir()
	unchangedDir := filepath.Join(root, "plugins", "old-format")
	changedDir := filepath.Join(root, "plugins", "really-changed")
	for _, dir := range []string{unchangedDir, changedDir} {
		if err := os.MkdirAll(dir, 0o750); err != nil {
			t.Fatal(err)
		}
	}
	writePluginFiles := func(dir, id string) {
		manifest := `{"id":"` + id + `","name":"N","version":"1.0.0"}`
		if err := os.WriteFile(filepath.Join(dir, "manifest.json"), []byte(manifest), 0o600); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, "main.js"), []byte("export function activate() {}"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	writePluginFiles(unchangedDir, "old-format")
	writePluginFiles(changedDir, "really-changed")

	store := servicetest.NewFakeStore()
	plugins := NewPluginService(filepath.Join(root, "settings.json"), nil, "source", "", "", nil)

	oldFormatContentHash := plugins.ContentHashOf("old-format")
	oldFormatCodeHash := plugins.CodeHashOf("old-format")
	if oldFormatContentHash == oldFormatCodeHash {
		t.Fatal("test setup: manifest.json must make ContentHash and CodeHash differ")
	}

	if err := store.Set("settings-allowed-plugins", `["old-format","really-changed"]`); err != nil {
		t.Fatal(err)
	}
	// Seed the lock the way a pre-0375-S2 install already carries it:
	// old-format recorded at its own ContentHash (the migration's
	// target), really-changed recorded at a hash matching neither of
	// its current hashes (a genuine file edit since it was allowed).
	lockJSON := fmt.Sprintf(`{"old-format":{"version":"1.0.0","hash":%q},"really-changed":{"version":"1.0.0","hash":"sha256-stale"}}`, oldFormatContentHash)
	if err := store.Set("settings-plugin-lock", lockJSON); err != nil {
		t.Fatal(err)
	}
	comp := compositionsvc.NewCompositionService(store)
	trig := triggersvc.NewTriggerService(comp, slog.Default(), store)
	settings := settingssvc.NewSettingsService(store, trig, false)
	secrets := secretsvc.NewSecretService(secretvault.New(filepath.Join(root, "secrets.kdbx")), credential.NewInMemory(), store)

	WirePluginTrust(plugins, settings, secrets)

	trust := pluginSettingsTrust(plugins, settings)
	if !trust.mayRun("old-format", false) {
		t.Fatal("an unchanged pre-CodeHash lock entry re-entered review")
	}
	locks, err := settings.GetPluginLock()
	if err != nil {
		t.Fatal(err)
	}
	if got := locks["old-format"].Hash; got != oldFormatContentHash {
		t.Fatalf("historical lock hash changed to %q, want %q", got, oldFormatContentHash)
	}
	if trust.mayRun("really-changed", false) {
		t.Fatal("a genuinely changed plugin ran without review")
	}
	if got := locks["really-changed"].Hash; got != "sha256-stale" {
		t.Fatalf("a genuinely changed lock entry was rewritten to %q", got)
	}
}
