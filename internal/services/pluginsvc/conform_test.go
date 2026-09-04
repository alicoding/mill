package pluginsvc

import (
	"bytes"
	"image"
	"image/png"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func writeConformPlugin(t *testing.T, root, id, manifest string, files map[string]string) string {
	t.Helper()
	dir := filepath.Join(root, id)
	if err := os.MkdirAll(dir, 0o750); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "manifest.json"), []byte(manifest), 0o600); err != nil {
		t.Fatal(err)
	}
	for name, body := range files {
		if err := os.MkdirAll(filepath.Dir(filepath.Join(dir, name)), 0o750); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	return dir
}

// writeTestIcon writes a minimal valid icon.png -- 128x128, standard
// rule 13's own size -- so a fixture testing something else does not
// also trip the icon check.
func writeTestIcon(t *testing.T, dir string) {
	t.Helper()
	var buf bytes.Buffer
	if err := png.Encode(&buf, image.NewRGBA(image.Rect(0, 0, iconSize, iconSize))); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "icon.png"), buf.Bytes(), 0o600); err != nil {
		t.Fatal(err)
	}
}

func TestConformDir_CleanPluginHasNoProblems(t *testing.T) {
	dir := writeConformPlugin(t, t.TempDir(), "good-one", `{"id":"good-one","name":"Good","version":"1.0.0","icon":"icon.png","capabilities":["fetch"],"contributes":{"network":[{"host":"*"}]}}`, map[string]string{"main.js": "export function activate() {}", "vendor/lib.js": "export const x = 1", "theme.css": ".a{}"})
	writeTestIcon(t, dir)
	if problems := ConformDir(dir, ""); len(problems) != 0 {
		t.Fatalf("expected no problems, got %v", problems)
	}
}

func TestConformDir_ReportsTheLoadersOwnRefusals(t *testing.T) {
	root := t.TempDir()
	dir := writeConformPlugin(t, root, "bad-one", `{"id":"other","name":"Bad","version":"1.0.0","icon":"icon.png","capabilities":["teleport"]}`, map[string]string{"main.js": ""})
	writeTestIcon(t, dir)
	problems := ConformDir(dir, "")
	if len(problems) != 1 || !strings.Contains(problems[0], `"other" must match the folder name`) {
		t.Fatalf("want the id/folder refusal, got %v", problems)
	}
}

func TestConformDir_UnservableFilesAndEscapingSymlinks(t *testing.T) {
	root := t.TempDir()
	dir := writeConformPlugin(t, root, "leaky", `{"id":"leaky","name":"Leaky","version":"1.0.0","icon":"icon.png"}`, map[string]string{"main.js": "export function activate() {}", "notes.md": "# hi", "img/logo.gif": "x"})
	writeTestIcon(t, dir)
	outside := filepath.Join(root, "outside.js")
	if err := os.WriteFile(outside, []byte(""), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(dir, "escape.js")); err != nil {
		t.Skip("symlinks unavailable here")
	}
	problems := ConformDir(dir, "")
	joined := strings.Join(problems, "\n")
	for _, want := range []string{"notes.md: only .js, .css, and .json", "logo.gif: only .js", "escape.js: a symlink must stay inside"} {
		if !strings.Contains(joined, want) {
			t.Errorf("missing %q in %v", want, problems)
		}
	}
}

// Every shipped example and the embedded built-in conform -- the
// suite an external author runs is the suite the repo's own plugins
// pass (ADR-0051).
func TestConformDir_EveryShippedPluginConforms(t *testing.T) {
	for _, glob := range []string{"../../../examples/plugins/*", "builtin/*"} {
		matches, _ := filepath.Glob(glob)
		var dirs []string
		for _, m := range matches {
			// examples/plugins now carries each example's README as a
			// sibling .md file (standard rule 14) alongside its folder --
			// only the folders are plugins.
			if info, err := os.Stat(m); err == nil && info.IsDir() {
				dirs = append(dirs, m)
			}
		}
		if len(dirs) == 0 {
			t.Fatalf("no plugins under %s", glob)
		}
		for _, dir := range dirs {
			if problems := ConformDir(dir, ""); len(problems) != 0 {
				t.Errorf("%s: %v", dir, problems)
			}
		}
	}
}

// The conformance checker an author runs before shipping reports a
// tool's declare-first problems in the author's own words, not a
// generic "invalid manifest".
func TestConformDir_ReportsAToolNamingAnUndeclaredCommand(t *testing.T) {
	manifest := `{"id":"toolish","name":"Toolish","version":"1.0.0","icon":"icon.png","contributes":{"tools":[` +
		`{"name":"refresh_index","description":"Lists again.","inputSchema":{"type":"object","properties":{}},"effect":"read","run":{"kind":"command","commandId":"refresh"}}]}}`
	dir := writeConformPlugin(t, t.TempDir(), "toolish", manifest, map[string]string{"main.js": "export function activate() {}"})
	writeTestIcon(t, dir)
	problems := ConformDir(dir, "")
	if len(problems) != 1 || !strings.Contains(problems[0], `names command "refresh", which contributes.commands does not declare`) {
		t.Fatalf("want the undeclared-command rule stated, got %v", problems)
	}
}
