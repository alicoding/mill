package pluginscaffold

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/alicoding/mill/internal/services/pluginsvc"
)

// The scaffold's whole promise: what it writes LOADS. The check is
// pluginsvc.ConformDir itself -- the same validator the loader runs --
// never a second copy of its rules here.
func TestRun_ScaffoldedFolderConforms(t *testing.T) {
	dir := t.TempDir()
	var out, errOut bytes.Buffer
	if code := Run([]string{"new", "demo", "--dir", dir}, "/plugins", "0.5.0", &out, &errOut); code != 0 {
		t.Fatalf("exit %d, stderr: %s", code, errOut.String())
	}
	target := filepath.Join(dir, "demo")
	if problems := pluginsvc.ConformDir(target, "0.5.0"); len(problems) > 0 {
		t.Fatalf("scaffolded folder does not conform: %v", problems)
	}
	if !strings.Contains(out.String(), target) {
		t.Errorf("the created path is not printed: %q", out.String())
	}
	if !strings.Contains(out.String(), "/plugins") {
		t.Errorf("the next step does not name the plugins folder: %q", out.String())
	}
}

func TestRun_ManifestParsesAndMatchesFolder(t *testing.T) {
	dir := t.TempDir()
	if code := Run([]string{"new", "My Notes Tool", "--dir", dir}, "/plugins", "0.5.0", &bytes.Buffer{}, &bytes.Buffer{}); code != 0 {
		t.Fatalf("exit %d", code)
	}
	raw, err := os.ReadFile(filepath.Join(dir, "my-notes-tool", "manifest.json")) // #nosec G304 -- this test's own t.TempDir()
	if err != nil {
		t.Fatal(err)
	}
	var m struct {
		ID, Name, Version, MinMillVersion string
	}
	if err := json.Unmarshal(raw, &m); err != nil {
		t.Fatalf("manifest.json is not valid JSON: %v", err)
	}
	if m.ID != "my-notes-tool" {
		t.Errorf("id = %q, want the folder name", m.ID)
	}
	if m.Name != "My Notes Tool" {
		t.Errorf("name = %q, want the typed name in title case", m.Name)
	}
	if m.MinMillVersion != "0.5.0" {
		t.Errorf("minMillVersion = %q, want the running Mill version", m.MinMillVersion)
	}
	main, err := os.ReadFile(filepath.Join(dir, "my-notes-tool", "main.js")) // #nosec G304 -- this test's own t.TempDir()
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(main), "export function activate(api)") {
		t.Errorf("main.js does not export activate:\n%s", main)
	}
}

func TestRun_ExistingFolderIsRefused(t *testing.T) {
	dir := t.TempDir()
	if err := os.Mkdir(filepath.Join(dir, "demo"), 0o750); err != nil {
		t.Fatal(err)
	}
	var errOut bytes.Buffer
	code := Run([]string{"new", "demo", "--dir", dir}, "/plugins", "0.5.0", &bytes.Buffer{}, &errOut)
	if code != 2 {
		t.Fatalf("exit %d, want 2", code)
	}
	if !strings.Contains(errOut.String(), "already exists") {
		t.Errorf("stderr = %q, want it to say the path already exists", errOut.String())
	}
}

func TestRun_UsageProblems(t *testing.T) {
	cases := []struct {
		name string
		args []string
	}{
		{"no subcommand", nil},
		{"unknown subcommand", []string{"list"}},
		{"no name", []string{"new"}},
		{"two names", []string{"new", "a", "b"}},
		{"dangling --dir", []string{"new", "a", "--dir"}},
		{"unknown option", []string{"new", "a", "--force"}},
		{"unusable name", []string{"new", "***"}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			var errOut bytes.Buffer
			if code := Run(c.args, "/plugins", "0.5.0", &bytes.Buffer{}, &errOut); code != 1 {
				t.Fatalf("exit %d, want 1", code)
			}
			if errOut.Len() == 0 {
				t.Error("a usage problem printed nothing to stderr")
			}
		})
	}
}

func TestSlugifyIDAndTitleLabel(t *testing.T) {
	cases := []struct{ in, id, label string }{
		{"demo", "demo", "Demo"},
		{"My Notes Tool", "my-notes-tool", "My Notes Tool"},
		{"mill-textcase", "mill-textcase", "Mill Textcase"},
		{"  Spaced  Out  ", "spaced-out", "Spaced Out"},
		{"Weird!!Chars", "weird-chars", "Weird!!Chars"},
	}
	for _, c := range cases {
		if got := SlugifyID(c.in); got != c.id {
			t.Errorf("SlugifyID(%q) = %q, want %q", c.in, got, c.id)
		}
		if got := TitleLabel(c.in); got != c.label {
			t.Errorf("TitleLabel(%q) = %q, want %q", c.in, got, c.label)
		}
	}
}
