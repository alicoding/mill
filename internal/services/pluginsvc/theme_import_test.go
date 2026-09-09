package pluginsvc

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/alicoding/mill/internal/domain/usererror"
)

func encodedTheme(raw []byte) string { return base64.StdEncoding.EncodeToString(raw) }

func themeFixture(t *testing.T, rel string) []byte {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("testdata", "theme-import", filepath.FromSlash(rel)))
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func TestPreviewThemeImport_RealFixtures(t *testing.T) {
	tests := []struct {
		file   string
		hash   string
		family string
		total  int
		mapped int
	}{
		{"catppuccin-3.18.1/latte.json", "c5739194f3d416a0056f507e016c369c1919ca77c2ae93709aaff64deffdf771", "light", 564, 14},
		{"catppuccin-3.18.1/mocha.json", "d099921170d0710dead1270cc85f2eb138311561cc2bdaac573149be05bfc4c3", "dark", 564, 14},
		{"vitesse-1.0.0/vitesse-light.json", "54c567a98b10a499b5302a53bb8aae2b0ef1ae03abdcfd1448e8617a4d3ae451", "", 184, 13},
		{"vitesse-1.0.0/vitesse-dark.json", "4c0d1ea6503bf17599fe1d615232ebae972028b93470f95431e8b61cc647e4f4", "", 186, 13},
	}
	p := New(t.TempDir(), nil, "1.0.0")
	for _, tc := range tests {
		t.Run(tc.file, func(t *testing.T) {
			raw := themeFixture(t, tc.file)
			got, err := p.PreviewThemeImport(encodedTheme(raw), filepath.Base(tc.file))
			if err != nil {
				t.Fatal(err)
			}
			if got.SourceSHA256 != tc.hash || got.Family != tc.family || got.Total != tc.total || got.Mapped != tc.mapped {
				t.Fatalf("preview = %+v", got)
			}
			if got.Mapped == 0 || got.Mapped+len(got.UnmappedKeys)+len(got.InvalidKeys) != got.Total {
				t.Fatalf("report partitions = %+v", got)
			}
		})
	}
}

func TestPreviewThemeImport_JSONCAndFallbacks(t *testing.T) {
	raw := []byte(`{
		// comments and trailing commas are accepted
		"name": "  Example  ", "type": "hcDark",
		"colors": {
			"foreground": "url(https://bad.example)",
			"editor.foreground": "#AABBCC",
			"editor.background": "#123",
			"unknown.role": "#000000",
		},
	}`)
	preview, css, err := parseThemeImport(raw, "example.jsonc")
	if err != nil {
		t.Fatal(err)
	}
	if preview.SuggestedName != "Example" || preview.Family != "dark" || preview.Mapped != 2 || preview.Total != 4 {
		t.Fatalf("preview = %+v", preview)
	}
	if strings.Join(preview.InvalidKeys, ",") != "foreground" || strings.Join(preview.UnmappedKeys, ",") != "unknown.role" {
		t.Fatalf("partition = %+v", preview)
	}
	if !strings.Contains(css, "--fgColor-default: #AABBCC;") || strings.Contains(css, "url(") || strings.Contains(css, "unknown.role") {
		t.Fatalf("css = %q", css)
	}
}

func TestPreviewThemeImport_Refusals(t *testing.T) {
	p := New(t.TempDir(), nil, "1.0.0")
	tests := []struct {
		name string
		raw  []byte
		code string
	}{
		{"malformed", []byte(`{`), "theme-import-invalid-json"},
		{"root", []byte(`[]`), "theme-import-invalid-root"},
		{"empty colors", []byte(`{"colors":{}}`), "theme-import-no-colors"},
		{"wrong colors type", []byte(`{"colors":[]}`), "theme-import-invalid-colors"},
		{"include", []byte(`{"include":"base.json","colors":{"foreground":"#000"}}`), "theme-import-include"},
		{"no usable", []byte(`{"colors":{"foreground":"red"}}`), "theme-import-no-usable-colors"},
		{"invalid utf8", []byte{0xff, 0xfe, 0xfd}, "theme-import-invalid-utf8"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			_, err := p.PreviewThemeImport(encodedTheme(tc.raw), "theme.json")
			if err == nil {
				t.Fatal("accepted invalid input")
			}
			got, ok := usererror.Of(err)
			if !ok || got.Code != tc.code {
				t.Fatalf("error = %#v, want %s", err, tc.code)
			}
		})
	}
	tooLarge := bytes.Repeat([]byte{' '}, maxThemeImportBytes+1)
	if _, err := p.PreviewThemeImport(encodedTheme(tooLarge), "large.json"); err == nil {
		t.Fatal("accepted oversized decoded input")
	}
	if _, err := p.PreviewThemeImport("not-base64", "bad.json"); err == nil {
		t.Fatal("accepted invalid base64")
	}
}

func TestImportTheme_PreservesBytesAndSurvivesRestart(t *testing.T) {
	root := t.TempDir()
	t.Setenv(PolicyPathEnv, filepath.Join(t.TempDir(), "absent.json"))
	raw := append([]byte{0xef, 0xbb, 0xbf}, []byte(`{"name":"BOM theme","type":"light","colors":{"editor.background":"#fff","foreground":"#111"}}`)...)
	p := New(root, nil, "1.0.0")
	result, err := p.ImportTheme(encodedTheme(raw), "source.json", "Chosen theme", "light")
	if err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256(raw)
	wantID := "imported-theme-light-" + hex.EncodeToString(digest[:])[:24]
	if result.PluginID != wantID || !result.NeedsAllow {
		t.Fatalf("result = %+v", result)
	}
	installed := filepath.Join(root, wantID)
	stored, err := os.ReadFile(filepath.Join(installed, "source.json")) // #nosec G304 -- test temp directory
	if err != nil || !bytes.Equal(stored, raw) {
		t.Fatalf("source bytes changed: err=%v equal=%v", err, bytes.Equal(stored, raw))
	}
	if problems := ConformDir(installed, "1.0.0"); len(problems) > 0 {
		t.Fatalf("conformance = %v", problems)
	}
	infos, err := New(root, nil, "1.0.0").ListPlugins()
	if err != nil {
		t.Fatal(err)
	}
	var found *PluginInfo
	for i := range infos {
		if infos[i].Manifest.ID == wantID {
			found = &infos[i]
			break
		}
	}
	if found == nil || found.Error != "" || !found.DataOnly || found.ThemeImport == nil || found.ThemeImport.SourceSHA256 != hex.EncodeToString(digest[:]) {
		t.Fatalf("restarted info = %+v", found)
	}
	before, _ := os.ReadFile(filepath.Join(installed, "theme.css")) // #nosec G304 -- test temp directory
	if _, err := p.ImportTheme(encodedTheme(raw), "source.json", "Overwrite", "light"); err == nil {
		t.Fatal("duplicate import overwrote the package")
	}
	after, _ := os.ReadFile(filepath.Join(installed, "theme.css")) // #nosec G304 -- test temp directory
	if !bytes.Equal(before, after) {
		t.Fatal("duplicate import changed existing files")
	}
}

func TestImportTheme_PolicyRefusalLeavesNoFolder(t *testing.T) {
	root := t.TempDir()
	writePolicy(t, `{"version":1,"managedBy":"Org","requiredTier":"verified","allowedSources":["theme-file"]}`)
	p := New(root, nil, "1.0.0")
	raw := []byte(`{"colors":{"foreground":"#fff"}}`)
	if _, err := p.ImportTheme(encodedTheme(raw), "theme.json", "Theme", "dark"); err == nil {
		t.Fatal("managed tier refusal was ignored")
	}
	entries, err := os.ReadDir(root)
	if err != nil && !os.IsNotExist(err) {
		t.Fatal(err)
	}
	if len(entries) != 0 {
		t.Fatalf("refusal left files: %v", entries)
	}
}

func TestImportTheme_ConcurrentCallsNeverReplace(t *testing.T) {
	root := t.TempDir()
	t.Setenv(PolicyPathEnv, filepath.Join(t.TempDir(), "absent.json"))
	p := New(root, nil, "1.0.0")
	raw := []byte(`{"colors":{"foreground":"#123456"}}`)
	type outcome struct {
		name string
		id   string
		err  error
	}
	start := make(chan struct{})
	results := make(chan outcome, 2)
	for _, name := range []string{"First", "Second"} {
		go func(name string) {
			<-start
			result, err := p.ImportTheme(encodedTheme(raw), "theme.json", name, "dark")
			results <- outcome{name: name, id: result.PluginID, err: err}
		}(name)
	}
	close(start)
	a, b := <-results, <-results
	successes := []outcome{}
	for _, result := range []outcome{a, b} {
		if result.err == nil {
			successes = append(successes, result)
		}
	}
	if len(successes) != 1 {
		t.Fatalf("outcomes = %+v, %+v", a, b)
	}
	info := p.resolvePlugin(successes[0].id)
	if info.Manifest.Name != successes[0].name {
		t.Fatalf("losing import replaced winner: info=%+v winner=%+v", info.Manifest, successes[0])
	}
	stored, err := os.ReadFile(filepath.Join(root, successes[0].id, "source.json")) // #nosec G304 -- test temp directory
	if err != nil || !bytes.Equal(stored, raw) {
		t.Fatalf("winner bytes changed: err=%v equal=%v", err, bytes.Equal(stored, raw))
	}
}

func TestDataOnlyManifest_IsNarrow(t *testing.T) {
	theme := Manifest{Contributes: ManifestContributes{Themes: []ThemeContribution{{ID: "theme", Label: "Theme", Family: "light", File: "theme.css"}}}}
	if !isDataOnlyManifest(theme) {
		t.Fatal("theme-only manifest was not data-only")
	}
	variants := []Manifest{
		{Capabilities: []string{"fetch"}, Contributes: theme.Contributes},
		{Dependencies: []DependencyContribution{{ID: "other"}}, Contributes: theme.Contributes},
		{Exports: []string{"value"}, Contributes: theme.Contributes},
		{Contributes: ManifestContributes{Themes: theme.Contributes.Themes, Commands: []CommandContribution{{ID: "x", Label: "X"}}}},
	}
	for _, variant := range variants {
		if isDataOnlyManifest(variant) {
			t.Fatalf("executable declaration classified data-only: %+v", variant)
		}
	}
}

func TestScanOne_DataOnlyRejectsShippedJavaScript(t *testing.T) {
	root := t.TempDir()
	id := "scripted-theme"
	dir := filepath.Join(root, id)
	if err := os.MkdirAll(filepath.Join(dir, "vendor"), 0o750); err != nil {
		t.Fatal(err)
	}
	manifest := `{"id":"scripted-theme","name":"Scripted theme","version":"1.0.0","contributes":{"themes":[{"id":"theme","label":"Theme","family":"light","file":"theme.css"}]}}`
	for name, body := range map[string]string{
		"manifest.json":    manifest,
		"theme.css":        "--fgColor-default: #111;",
		"vendor/unused.js": "export const unused = true",
	} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	info := New(root, nil, "1.0.0").scanOne(id)
	if info.DataOnly || !strings.Contains(info.Error, "cannot contain JavaScript") {
		t.Fatalf("scripted data-only theme = %+v", info)
	}
	if problems := ConformDir(dir, "1.0.0"); !strings.Contains(strings.Join(problems, "\n"), "cannot contain JavaScript") {
		t.Fatalf("conformance = %v", problems)
	}
	if _, err := New(t.TempDir(), nil, "1.0.0").stagedChecks(dir, InstallRecord{Source: PluginSource{Kind: "theme-file"}, Tier: TierDev}); err == nil {
		t.Fatal("staged install admitted JavaScript in a data-only theme")
	} else if got, ok := usererror.Of(err); !ok || got.Code != InstallRefusedCode {
		t.Fatalf("staged error = %#v, want %s", err, InstallRefusedCode)
	}
}

func TestScanOne_ThemeImportEvidenceRequiresMatchingHostReceipt(t *testing.T) {
	root := t.TempDir()
	t.Setenv(PolicyPathEnv, filepath.Join(t.TempDir(), "absent.json"))
	p := New(root, nil, "1.0.0")
	raw := []byte(`{"name":"Receipt theme","colors":{"foreground":"#123456"}}`)
	result, err := p.ImportTheme(encodedTheme(raw), "receipt.json", "Receipt theme", "dark")
	if err != nil {
		t.Fatal(err)
	}
	dir := filepath.Join(root, result.PluginID)
	if info := p.scanOne(result.PluginID); info.ThemeImport == nil {
		t.Fatalf("host import evidence missing: %+v", info)
	}
	rec, ok := ReadInstallRecord(dir)
	if !ok {
		t.Fatal("host import receipt missing")
	}
	rec.Source = PluginSource{Kind: "github", Repo: "acme/theme"}
	if err := WriteInstallRecord(dir, rec); err != nil {
		t.Fatal(err)
	}
	if info := p.scanOne(result.PluginID); info.ThemeImport != nil {
		t.Fatalf("non-theme receipt exposed imported evidence: %+v", info.ThemeImport)
	}
	rec.Source = PluginSource{Kind: "theme-file", Name: "receipt.json"}
	if err := os.WriteFile(filepath.Join(dir, "theme.css"), []byte("--fgColor-default: #abcdef;\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	rec.ContentHash, err = ContentHash(dir)
	if err != nil {
		t.Fatal(err)
	}
	if err := WriteInstallRecord(dir, rec); err != nil {
		t.Fatal(err)
	}
	if info := p.scanOne(result.PluginID); info.ThemeImport != nil {
		t.Fatalf("mismatched generated package exposed evidence: %+v", info.ThemeImport)
	}
}

func TestScanOne_ThemeWithMainRemainsExecutable(t *testing.T) {
	root := t.TempDir()
	id := "native-theme"
	dir := filepath.Join(root, id)
	if err := os.MkdirAll(dir, 0o750); err != nil {
		t.Fatal(err)
	}
	manifest := `{"id":"native-theme","name":"Native theme","version":"1.0.0","contributes":{"themes":[{"id":"theme","label":"Theme","family":"light","file":"theme.css"}]}}`
	for name, body := range map[string]string{"manifest.json": manifest, "theme.css": "--fgColor-default: #111;", "main.js": "export function activate() {}"} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	info := New(root, nil, "1.0.0").scanOne(id)
	if info.Error != "" || info.DataOnly {
		t.Fatalf("theme with main.js = %+v", info)
	}
}
