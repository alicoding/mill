package pluginsvc

import (
	"bytes"
	"crypto/sha256"
	_ "embed"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"unicode/utf8"

	"github.com/alicoding/mill/internal/domain/usererror"
	"github.com/tailscale/hujson"
)

//go:embed theme_import_icon.png
var themeImportIcon []byte

const (
	maxThemeImportBytes = 2 << 20
	themeMapperVersion  = 1
	themeImportFile     = "theme-import.json"
)

// ThemeImportPreview is the host-owned compatibility report shown before
// importing a foreign color-theme file. CSS stays on the backend: the UI
// receives the evidence, never another copy of the mapping algorithm.
type ThemeImportPreview struct {
	SourceName    string
	SourceSHA256  string
	SuggestedName string
	Family        string
	Mapped        int
	Total         int
	MappedKeys    []string
	UnmappedKeys  []string
	InvalidKeys   []string
	sourceTheme   string
}

// ThemeImportMetadata is preserved beside the original bytes and generated
// stylesheet, and is also exposed on PluginInfo for the Verification tab.
type ThemeImportMetadata struct {
	SourceName    string   `json:"sourceName"`
	SourceSHA256  string   `json:"sourceSHA256"`
	MapperVersion int      `json:"mapperVersion"`
	SourceTheme   string   `json:"sourceTheme,omitempty"`
	Family        string   `json:"family"`
	Mapped        int      `json:"mapped"`
	Total         int      `json:"total"`
	MappedKeys    []string `json:"mappedKeys"`
	UnmappedKeys  []string `json:"unmappedKeys"`
	InvalidKeys   []string `json:"invalidKeys"`
}

type ThemeImportResult struct {
	PluginID   string
	NeedsAllow bool
}

type sourceTheme struct {
	Name   string
	Type   string
	Colors map[string]json.RawMessage
}

type themeRole struct {
	Destinations []string
	Sources      []string
}

// themeRoles is the entire v1 adapter. Ordering is significant: the first
// present valid source wins, while an invalid value lets the next fallback
// try. One source may intentionally supply more than one Mill token.
var themeRoles = []themeRole{
	{[]string{"--fgColor-default"}, []string{"foreground", "editor.foreground"}},
	{[]string{"--fgColor-muted"}, []string{"descriptionForeground", "disabledForeground"}},
	{[]string{"--bgColor-default"}, []string{"editor.background"}},
	{[]string{"--bgColor-muted"}, []string{"sideBar.background", "panel.background"}},
	{[]string{"--borderColor-default"}, []string{"panel.border", "contrastBorder"}},
	{[]string{"--fgColor-accent", "--mill-accent-fg"}, []string{"textLink.foreground", "focusBorder"}},
	{[]string{"--bgColor-accent-emphasis", "--mill-accent-emphasis"}, []string{"button.background"}},
	{[]string{"--fgColor-onEmphasis"}, []string{"button.foreground"}},
	{[]string{"--borderColor-accent-emphasis"}, []string{"button.border", "button.background"}},
	{[]string{"--mill-accent-muted"}, []string{"list.inactiveSelectionBackground"}},
	{[]string{"--mill-accent-border-muted"}, []string{"focusBorder"}},
	{[]string{"--fgColor-danger"}, []string{"errorForeground", "editorError.foreground"}},
	{[]string{"--fgColor-attention"}, []string{"editorWarning.foreground", "terminal.ansiYellow"}},
	{[]string{"--fgColor-success"}, []string{"testing.iconPassed", "terminal.ansiGreen"}},
}

// PreviewThemeImport parses JSON with comments and trailing commas, then
// reports exactly which interface colors the v1 mapping can use.
func (p *PluginService) PreviewThemeImport(encoded, basename string) (ThemeImportPreview, error) {
	raw, err := decodeThemeImport(encoded)
	if err != nil {
		return ThemeImportPreview{}, err
	}
	parsed, _, err := parseThemeImport(raw, basename)
	return parsed, err
}

// ImportTheme re-runs the authoritative parser and mapping before staging a
// data-only extension through the same policy and static checks as any other
// local install.
func (p *PluginService) ImportTheme(encoded, basename, displayName, family string) (ThemeImportResult, error) {
	raw, err := decodeThemeImport(encoded)
	if err != nil {
		return ThemeImportResult{}, err
	}
	preview, css, err := parseThemeImport(raw, basename)
	if err != nil {
		return ThemeImportResult{}, err
	}
	name := strings.TrimSpace(displayName)
	if name == "" {
		return ThemeImportResult{}, usererror.New("theme-import-name-required", "Enter a name for this theme.")
	}
	if len([]rune(name)) > 120 {
		return ThemeImportResult{}, usererror.New("theme-import-name-too-long", "Keep the theme name to 120 characters or fewer.")
	}
	if family != "light" && family != "dark" {
		return ThemeImportResult{}, usererror.New("theme-import-family-required", "Choose a light or dark appearance.")
	}
	if err := policySourceRefusal("", "theme-file"); err != nil {
		return ThemeImportResult{}, err
	}
	id := "imported-theme-" + family + "-" + preview.SourceSHA256[:24]
	if p.installedFolderExists(id) {
		return ThemeImportResult{}, usererror.New("theme-import-duplicate", "This theme is already imported. Remove it from Extensions before importing it again.")
	}
	stage, cleanup, err := stageDir()
	if err != nil {
		return ThemeImportResult{}, err
	}
	defer cleanup()
	manifest := Manifest{
		ID: id, Name: name, Version: "1.0.0",
		Description: "Imported color theme", Icon: "icon.png", Contributes: ManifestContributes{
			Themes: []ThemeContribution{{ID: "theme", Label: name, Family: family, File: "theme.css"}},
		},
	}
	metadata := ThemeImportMetadata{
		SourceName: preview.SourceName, SourceSHA256: preview.SourceSHA256,
		MapperVersion: themeMapperVersion, SourceTheme: preview.sourceTheme,
		Family: family, Mapped: preview.Mapped, Total: preview.Total,
		MappedKeys: preview.MappedKeys, UnmappedKeys: preview.UnmappedKeys, InvalidKeys: preview.InvalidKeys,
	}
	if err := writeThemeImportStage(stage, manifest, metadata, raw, css); err != nil {
		return ThemeImportResult{}, err
	}
	_, err = p.finishThemeInstall(stage, InstallRecord{Source: PluginSource{Kind: "theme-file", Name: preview.SourceName}, Tier: TierDev})
	if err != nil {
		return ThemeImportResult{}, err
	}
	return ThemeImportResult{PluginID: id, NeedsAllow: true}, nil
}

func decodeThemeImport(encoded string) ([]byte, error) {
	if len(encoded) > base64.StdEncoding.EncodedLen(maxThemeImportBytes) {
		return nil, usererror.New("theme-import-too-large", "Choose a theme file smaller than 2 MiB.")
	}
	raw, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return nil, usererror.Wrap("theme-import-invalid-bytes", "Choose a valid theme file.", err)
	}
	if len(raw) > maxThemeImportBytes {
		return nil, usererror.New("theme-import-too-large", "Choose a theme file smaller than 2 MiB.")
	}
	return raw, nil
}

func parseThemeImport(raw []byte, basename string) (ThemeImportPreview, string, error) {
	if len(raw) > maxThemeImportBytes {
		return ThemeImportPreview{}, "", usererror.New("theme-import-too-large", "Choose a theme file smaller than 2 MiB.")
	}
	parseRaw := bytes.TrimPrefix(raw, []byte{0xef, 0xbb, 0xbf})
	if !utf8.Valid(parseRaw) {
		return ThemeImportPreview{}, "", usererror.New("theme-import-invalid-utf8", "Choose a theme file encoded as UTF-8.")
	}
	if strings.TrimSpace(string(parseRaw)) == "" {
		return ThemeImportPreview{}, "", usererror.New("theme-import-invalid-json", "Choose a valid JSON or JSONC theme file.")
	}
	value, err := hujson.Parse(parseRaw)
	if err != nil {
		return ThemeImportPreview{}, "", usererror.Wrap("theme-import-invalid-json", "Choose a valid JSON or JSONC theme file.", err)
	}
	value.Standardize()
	var root map[string]json.RawMessage
	if err := json.Unmarshal(value.Pack(), &root); err != nil || root == nil {
		return ThemeImportPreview{}, "", usererror.New("theme-import-invalid-root", "Choose a theme file with a JSON object at its root.")
	}
	if includeMeaningful(root["include"]) {
		return ThemeImportPreview{}, "", usererror.New("theme-import-include", "This theme includes another file. Choose a self-contained theme file.")
	}
	colorsRaw, found := root["colors"]
	if !found || string(colorsRaw) == "null" {
		return ThemeImportPreview{}, "", usererror.New("theme-import-no-colors", "Choose a theme file with a nonempty colors object.")
	}
	var colors map[string]json.RawMessage
	if err := json.Unmarshal(colorsRaw, &colors); err != nil || colors == nil {
		return ThemeImportPreview{}, "", usererror.New("theme-import-invalid-colors", "Choose a theme file whose colors value is an object.")
	}
	src := sourceTheme{Name: jsonString(root["name"]), Type: jsonString(root["type"]), Colors: colors}
	if len(src.Colors) == 0 {
		return ThemeImportPreview{}, "", usererror.New("theme-import-no-colors", "Choose a theme file with a nonempty colors object.")
	}
	css, mapped, unmapped, invalid := mapThemeColors(src.Colors)
	if len(mapped) == 0 {
		return ThemeImportPreview{}, "", usererror.New("theme-import-no-usable-colors", "This theme has no interface colors Mill can use.")
	}
	if _, problem := ValidateThemeCSS(css); problem != "" {
		return ThemeImportPreview{}, "", fmt.Errorf("generated theme CSS: %s", problem)
	}
	hash := sha256.Sum256(raw)
	name := strings.TrimSpace(src.Name)
	if name == "" {
		name = strings.TrimSuffix(cleanThemeBasename(basename), filepath.Ext(cleanThemeBasename(basename)))
	}
	preview := ThemeImportPreview{
		SourceName: cleanThemeBasename(basename), SourceSHA256: hex.EncodeToString(hash[:]),
		SuggestedName: name, Family: sourceThemeFamily(src.Type), Mapped: len(mapped), Total: len(src.Colors),
		MappedKeys: mapped, UnmappedKeys: unmapped, InvalidKeys: invalid, sourceTheme: strings.TrimSpace(src.Name),
	}
	return preview, css, nil
}

func jsonString(raw json.RawMessage) string {
	var value string
	_ = json.Unmarshal(raw, &value)
	return value
}

func includeMeaningful(raw json.RawMessage) bool {
	if len(raw) == 0 || string(raw) == "null" {
		return false
	}
	var value string
	return json.Unmarshal(raw, &value) != nil || strings.TrimSpace(value) != ""
}

func mapThemeColors(colors map[string]json.RawMessage) (string, []string, []string, []string) {
	used := map[string]bool{}
	invalid := map[string]bool{}
	var css strings.Builder
	for _, role := range themeRoles {
		color, ok := firstValidRoleColor(colors, role.Sources, used, invalid)
		if !ok {
			continue
		}
		for _, destination := range role.Destinations {
			fmt.Fprintf(&css, "%s: %s;\n", destination, color)
		}
	}
	mapped := sortedKeys(used)
	bad := sortedKeys(invalid)
	unmappedSet := map[string]bool{}
	for key := range colors {
		if !used[key] && !invalid[key] {
			unmappedSet[key] = true
		}
	}
	return css.String(), mapped, sortedKeys(unmappedSet), bad
}

func firstValidRoleColor(colors map[string]json.RawMessage, sources []string, used, invalid map[string]bool) (string, bool) {
	for _, source := range sources {
		raw, present := colors[source]
		if !present {
			continue
		}
		var color string
		if json.Unmarshal(raw, &color) != nil || !validHexColor(color) {
			invalid[source] = true
			continue
		}
		used[source] = true
		return strings.TrimSpace(color), true
	}
	return "", false
}

func validHexColor(value string) bool {
	v := strings.TrimSpace(value)
	if len(v) != 4 && len(v) != 5 && len(v) != 7 && len(v) != 9 {
		return false
	}
	if v[0] != '#' {
		return false
	}
	_, err := hex.DecodeString(expandOddHex(v[1:]))
	return err == nil
}

func expandOddHex(value string) string {
	if len(value)%2 == 0 {
		return value
	}
	var out strings.Builder
	for _, r := range value {
		out.WriteRune(r)
		out.WriteRune(r)
	}
	return out.String()
}

func sourceThemeFamily(value string) string {
	switch value {
	case "light", "hcLight":
		return "light"
	case "dark", "hcDark":
		return "dark"
	default:
		return ""
	}
}

func cleanThemeBasename(value string) string {
	clean := filepath.Base(strings.ReplaceAll(strings.TrimSpace(value), `\`, "/"))
	if clean == "" || clean == "." {
		return "theme.json"
	}
	return clean
}

func sortedKeys(values map[string]bool) []string {
	out := make([]string, 0, len(values))
	for key := range values {
		out = append(out, key)
	}
	sort.Strings(out)
	return out
}

func writeThemeImportStage(dir string, manifest Manifest, metadata ThemeImportMetadata, raw []byte, css string) error {
	manifestRaw, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return err
	}
	metadataRaw, err := json.MarshalIndent(metadata, "", "  ")
	if err != nil {
		return err
	}
	files := []struct {
		name string
		data []byte
	}{
		{"manifest.json", append(manifestRaw, '\n')},
		{"source.json", raw},
		{"theme.css", []byte(css)},
		{themeImportFile, append(metadataRaw, '\n')},
		{"icon.png", themeImportIcon},
	}
	for _, file := range files {
		if err := os.WriteFile(filepath.Join(dir, file.name), file.data, 0o600); err != nil {
			return err
		}
	}
	return nil
}

func readThemeImportMetadata(dir string) *ThemeImportMetadata {
	raw, err := os.ReadFile(filepath.Join(dir, themeImportFile)) // #nosec G304,G703 -- the scanned plugin's own folder
	if err != nil {
		return nil
	}
	var metadata ThemeImportMetadata
	if json.Unmarshal(raw, &metadata) != nil || metadata.MapperVersion == 0 {
		return nil
	}
	return &metadata
}
