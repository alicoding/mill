package pluginsvc

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// The install checks (docs/goals/0349 S6, standard rules 24-26): one
// fixture per refusal and per warning, and a clean sibling.

func installFixture(t *testing.T, files map[string]string) string {
	t.Helper()
	dir := t.TempDir()
	for name, body := range files {
		path := filepath.Join(dir, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(path), 0o750); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	return dir
}

func wantFinding(t *testing.T, findings []string, want string) {
	t.Helper()
	for _, f := range findings {
		if strings.Contains(f, want) {
			return
		}
	}
	t.Fatalf("want a finding containing %q, got %v", want, findings)
}

func TestInstallChecks_CleanPluginHasNoFindings(t *testing.T) {
	dir := installFixture(t, map[string]string{
		"main.js": "export function activate(api) { api.notify({ text: 'hi' }) }\n// docs: https://example.test/readme\n/* see https://example.test/license */\n",
	})
	refusals, warnings := InstallChecks(dir, Manifest{})
	if len(refusals) != 0 || len(warnings) != 0 {
		t.Fatalf("clean plugin: refusals %v warnings %v", refusals, warnings)
	}
}

func TestInstallChecks_RefusesRuntimeCode(t *testing.T) {
	cases := map[string]string{
		"eval":          "const f = eval('1+1')\n",
		"new Function":  "const f = new Function('return 1')\n",
		"import of URL": "const m = await import('https://cdn.example.test/lib.js')\n",
	}
	for name, body := range cases {
		dir := installFixture(t, map[string]string{"main.js": body})
		refusals, _ := InstallChecks(dir, Manifest{})
		if len(refusals) == 0 {
			t.Errorf("%s: not refused", name)
			continue
		}
		wantFinding(t, refusals, "standard rule 24: main.js")
	}
	html := installFixture(t, map[string]string{"view.html": `<html><body><script src="https://cdn.example.test/x.js"></script></body></html>`})
	refusals, _ := InstallChecks(html, Manifest{})
	wantFinding(t, refusals, "standard rule 24: view.html: loads a script from the web")
}

func TestInstallChecks_RefusesAnUndeclaredHost(t *testing.T) {
	dir := installFixture(t, map[string]string{"main.js": "const url = 'https://api.example.test/v1'\n"})
	refusals, _ := InstallChecks(dir, Manifest{})
	wantFinding(t, refusals, "standard rule 25: main.js: reaches api.example.test without declaring it")

	declared := Manifest{Contributes: ManifestContributes{Network: []NetworkContribution{{Host: "api.example.test"}}}}
	if refusals, _ := InstallChecks(dir, declared); len(refusals) != 0 {
		t.Fatalf("declared host refused: %v", refusals)
	}
	wildcard := Manifest{Contributes: ManifestContributes{Network: []NetworkContribution{{Host: "*.example.test"}}}}
	if refusals, _ := InstallChecks(dir, wildcard); len(refusals) != 0 {
		t.Fatalf("wildcard host refused: %v", refusals)
	}
	any := Manifest{Contributes: ManifestContributes{Network: []NetworkContribution{{Host: AnyHost}}}}
	if refusals, _ := InstallChecks(dir, any); len(refusals) != 0 {
		t.Fatalf("any-host declaration refused: %v", refusals)
	}
}

func TestInstallChecks_ExemptsLoopbackAndNamespaces(t *testing.T) {
	dir := installFixture(t, map[string]string{
		"main.js": "const a = 'http://localhost:8080/'\nconst b = 'http://127.0.0.1/'\nconst svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')\n",
	})
	refusals, _ := InstallChecks(dir, Manifest{})
	if len(refusals) != 0 {
		t.Fatalf("exempt hosts refused: %v", refusals)
	}
}

// A bundled library's own address warns rather than refuses.
func TestInstallChecks_VendoredHostWarns(t *testing.T) {
	dir := installFixture(t, map[string]string{"vendor/lib.js": "var cdn = 'https://cdn.example.test/npm/'\n"})
	refusals, warnings := InstallChecks(dir, Manifest{})
	if len(refusals) != 0 {
		t.Fatalf("vendored code refused: %v", refusals)
	}
	wantFinding(t, warnings, "standard rule 25: vendor/lib.js: its bundled code names cdn.example.test")
}

func TestInstallChecks_WarnsOnUnreadableCode(t *testing.T) {
	big := strings.Repeat("function a(){return 1}\n", minifiedScriptBytes/20)
	blob := "const data = '" + strings.Repeat("QUJD", base64BlobBytes/4+1) + "'\n"
	noisy := "const k = '" + noisyLine(entropyLineChars+10) + "'\n"
	for name, body := range map[string]string{"minified": big, "base64": blob, "entropy": noisy} {
		dir := installFixture(t, map[string]string{"main.js": body})
		_, warnings := InstallChecks(dir, Manifest{})
		if len(warnings) == 0 {
			t.Errorf("%s: no warning", name)
			continue
		}
		wantFinding(t, warnings, "standard rule 26: main.js: "+unreadableCodeSentence)
	}
	mapped := installFixture(t, map[string]string{"main.js": big + "//# sourceMappingURL=main.js.map\n"})
	if _, warnings := InstallChecks(mapped, Manifest{}); len(warnings) != 0 {
		t.Fatalf("a large script with a source map warned: %v", warnings)
	}
}

// noisyLine builds a line using every printable byte evenly, whose
// entropy is well above the threshold.
func noisyLine(n int) string {
	var b strings.Builder
	for i := 0; i < n; i++ {
		b.WriteByte(byte(0x21 + (i*7)%90))
	}
	return b.String()
}

func TestInstallRefusalSentence(t *testing.T) {
	got := installRefusalSentence("standard rule 25: main.js: reaches api.example.test without declaring it")
	if got != "Reaches api.example.test without declaring it (main.js)." {
		t.Fatalf("sentence = %q", got)
	}
}
