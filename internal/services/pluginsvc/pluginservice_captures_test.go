package pluginsvc

import (
	"strings"
	"testing"
)

func TestCaptures_ListDeclaredOnesForRunnablePlugins(t *testing.T) {
	root := t.TempDir()
	writePlugin(t, root, "cap", `{"id":"cap","name":"Capturer","version":"1","contributes":{"captures":[{"id":"quick","label":"Quick thing","description":"One line."}]}}`, nil)
	writePlugin(t, root, "bad", `{"id":"bad","name":"B","version":"1","contributes":{"captures":[{"id":"Bad Id","label":"x"}]}}`, nil)
	p := New(root, nil, "")
	got := p.Captures()
	if len(got) != 1 || got[0].PluginID != "cap" || got[0].ID != "quick" || got[0].Label != "Quick thing" || got[0].PluginName != "Capturer" {
		t.Fatalf("Captures = %+v", got)
	}
	infos, _ := p.ListPlugins()
	for _, i := range infos {
		if i.Manifest.ID == "bad" && !strings.Contains(i.Error, "contributed capture id") {
			t.Fatalf("bad capture id error = %q", i.Error)
		}
	}
	p.SetRunPolicy(func(string, bool) bool { return false })
	if len(p.Captures()) != 0 {
		t.Fatal("a plugin that may not run offered a capture")
	}
}
