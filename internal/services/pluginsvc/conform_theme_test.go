package pluginsvc

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func writeThemeFixture(t *testing.T, files map[string]string) string {
	t.Helper()
	dir := t.TempDir()
	for rel, content := range files {
		path := filepath.Join(dir, filepath.FromSlash(rel))
		if err := os.MkdirAll(filepath.Dir(path), 0o750); err != nil {
			t.Fatalf("mkdir: %v", err)
		}
		if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
			t.Fatalf("write %s: %v", rel, err)
		}
	}
	return dir
}

func TestConformTheme_DocumentedVariablesPass(t *testing.T) {
	dir := writeThemeFixture(t, map[string]string{
		"style.css": ".panel { color: var(--fgColor-default); border: 1px solid var(--borderColor-default); }",
		"main.js":   "el.style.cssText = 'background:var(--bgColor-muted);color:var(--mill-accent-fg)'",
	})
	problems, warnings := conformTheme(dir)
	if len(problems) != 0 {
		t.Errorf("problems = %v, want none", problems)
	}
	if len(warnings) != 0 {
		t.Errorf("warnings = %v, want none", warnings)
	}
}

func TestConformTheme_UndocumentedVariableFails(t *testing.T) {
	dir := writeThemeFixture(t, map[string]string{
		"style.css": ".panel { color: var(--bgColor-danger-emphasis); }",
	})
	problems, _ := conformTheme(dir)
	if len(problems) != 1 || !strings.Contains(problems[0], "--bgColor-danger-emphasis") {
		t.Fatalf("problems = %v, want one naming --bgColor-danger-emphasis", problems)
	}
}

// A plugin owns its own namespace: reading a variable it defines itself
// is exactly how a vendored engine is themed.
func TestConformTheme_SelfDefinedVariablePasses(t *testing.T) {
	dir := writeThemeFixture(t, map[string]string{
		"style.css": ".panel { --my-engine-bg: var(--bgColor-default); background: var(--my-engine-bg); }",
	})
	if problems, _ := conformTheme(dir); len(problems) != 0 {
		t.Errorf("problems = %v, want none", problems)
	}
}

func TestConformTheme_HardcodedColorWarnsButDoesNotFail(t *testing.T) {
	dir := writeThemeFixture(t, map[string]string{
		"main.js": "el.style.cssText = 'color:#1f6feb;background:rgb(9, 105, 218)'",
	})
	problems, warnings := conformTheme(dir)
	if len(problems) != 0 {
		t.Errorf("problems = %v, want none -- a literal is advice, not a failure", problems)
	}
	if len(warnings) != 1 || !strings.Contains(warnings[0], "main.js") {
		t.Fatalf("warnings = %v, want one naming main.js", warnings)
	}
}

// vendor/ is third-party code the author did not write; its palette and
// its variable namespace are out of the check's scope.
func TestConformTheme_VendorFolderIsNotJudged(t *testing.T) {
	dir := writeThemeFixture(t, map[string]string{
		"vendor/engine.js": "s = 'color:#1f6feb;background:var(--engine-only-name)'",
	})
	problems, warnings := conformTheme(dir)
	if len(problems) != 0 || len(warnings) != 0 {
		t.Errorf("problems = %v, warnings = %v, want none", problems, warnings)
	}
}

// Every shipped example is the contract's own proof: they pass with no
// problems AND no warnings, so the check never sits permanently noisy.
func TestConformTheme_EveryShippedExampleIsClean(t *testing.T) {
	dirs, err := filepath.Glob(filepath.Join("..", "..", "..", "examples", "plugins", "*"))
	if err != nil || len(dirs) == 0 {
		t.Fatalf("glob examples: %v (found %d)", err, len(dirs))
	}
	for _, dir := range dirs {
		t.Run(filepath.Base(dir), func(t *testing.T) {
			problems, warnings := conformTheme(dir)
			if len(problems) != 0 {
				t.Errorf("problems = %v, want none", problems)
			}
			if len(warnings) != 0 {
				t.Errorf("warnings = %v, want none", warnings)
			}
		})
	}
}
