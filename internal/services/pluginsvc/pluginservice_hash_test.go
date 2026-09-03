package pluginsvc

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// The hash covers every served file's path and bytes, ignores hidden
// entries, and changes when any file changes.
func TestContentHash_TracksFileContent(t *testing.T) {
	root := t.TempDir()
	writePlugin(t, root, "a", `{"id":"a","name":"A","version":"1"}`, map[string]string{"steps.js": "registerStep('x',{perform:function(){return ''}})"})
	dir := filepath.Join(root, "a")
	first, err := ContentHash(dir)
	if err != nil || !strings.HasPrefix(first, "sha256-") {
		t.Fatalf("ContentHash = %q err=%v", first, err)
	}
	if again, _ := ContentHash(dir); again != first {
		t.Fatal("hash not stable across calls")
	}
	if err := os.WriteFile(filepath.Join(dir, ".DS_Store"), []byte("noise"), 0o600); err != nil {
		t.Fatal(err)
	}
	if hidden, _ := ContentHash(dir); hidden != first {
		t.Fatal("a hidden file changed the hash")
	}
	time.Sleep(10 * time.Millisecond)
	if err := os.WriteFile(filepath.Join(dir, "main.js"), []byte("export function activate() { /* changed */ }"), 0o600); err != nil {
		t.Fatal(err)
	}
	changed, _ := ContentHash(dir)
	if changed == first {
		t.Fatal("an edited file kept the hash")
	}
	p := New(root, nil, "")
	if got := p.ContentHashOf("a"); got != changed {
		t.Fatalf("ContentHashOf = %q, want %q", got, changed)
	}
	if got := p.ContentHashOf("mill-drawing"); got != "" {
		t.Fatalf("a built-in has a content hash: %q", got)
	}
}
