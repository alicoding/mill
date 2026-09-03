package wiring

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/alicoding/mill/internal/services/atlassvc"
	"github.com/alicoding/mill/internal/services/pluginsvc"
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
	if got := kinds(orderPasteClaims(claims, nil, "")); got != "archive,bookmark,clip" {
		t.Errorf("no preference = %q", got)
	}
	if got := kinds(orderPasteClaims(claims, nil, "clip")); got != "clip,archive,bookmark" {
		t.Errorf("preferred clip = %q", got)
	}
	if got := kinds(orderPasteClaims(claims, map[string]bool{"mill-archive": true}, "bookmark")); got != "bookmark,clip" {
		t.Errorf("disabled archive, preferred bookmark = %q", got)
	}
	if got := kinds(orderPasteClaims(claims, nil, "nobody")); got != "archive,bookmark,clip" {
		t.Errorf("unknown preference = %q", got)
	}
}
