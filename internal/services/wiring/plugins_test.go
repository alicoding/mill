package wiring

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
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
	if err != nil || len(srcInfos) != 1 {
		t.Fatalf("source ListPlugins() = %+v err=%v, want 1 row", srcInfos, err)
	}
	if srcInfos[0].Error != "" {
		t.Fatalf("source build refused the pinned plugin: %q", srcInfos[0].Error)
	}

	betaInfos, err := NewPluginService(settingsPath, nil, "beta", "0.5.0").ListPlugins()
	if err != nil || len(betaInfos) != 1 {
		t.Fatalf("beta ListPlugins() = %+v err=%v, want 1 row", betaInfos, err)
	}
	if !strings.Contains(betaInfos[0].Error, "needs Mill 9.9.9") {
		t.Fatalf("beta build Error = %q, want the version refusal", betaInfos[0].Error)
	}
}
