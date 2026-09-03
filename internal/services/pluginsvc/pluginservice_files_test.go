package pluginsvc

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestListDir_FoldersFirstHiddenSkipped(t *testing.T) {
	dir := t.TempDir()
	for _, name := range []string{"ping.bru", "zeta.bru", ".DS_Store", "bruno.json"} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte("x"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	for _, sub := range []string{"environments", "node_modules", ".git"} {
		if err := os.Mkdir(filepath.Join(dir, sub), 0o750); err != nil {
			t.Fatal(err)
		}
	}
	got, err := listDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	names := make([]string, 0, len(got))
	for _, e := range got {
		names = append(names, e.Name)
	}
	if strings.Join(names, ",") != "environments,bruno.json,ping.bru,zeta.bru" {
		t.Fatalf("names = %v", names)
	}
	if !got[0].IsDir || got[1].IsDir || got[1].Size != 1 || got[1].Path != filepath.Join(dir, "bruno.json") {
		t.Fatalf("entries = %+v", got)
	}
}

func TestListDirForPlugin_NeedsCapabilityAndAbsolutePath(t *testing.T) {
	root := t.TempDir()
	writePlugin(t, root, "nocap", `{"id":"nocap","name":"N","version":"1"}`, nil)
	writePlugin(t, root, "lister", `{"id":"lister","name":"L","version":"1","capabilities":["list-files"]}`, nil)
	p := New(root, nil, "")
	if _, err := p.ListDirForPlugin("nocap", root); err == nil || !strings.Contains(err.Error(), "list-files") {
		t.Fatalf("no capability err = %v", err)
	}
	if _, err := p.ListDirForPlugin("lister", "relative/dir"); err == nil || !strings.Contains(err.Error(), "absolute") {
		t.Fatalf("relative err = %v", err)
	}
	if _, err := p.ListDirForPlugin("lister", root); err == nil || !strings.Contains(err.Error(), "guardrail") {
		t.Fatalf("no guardrail err = %v", err)
	}
}
