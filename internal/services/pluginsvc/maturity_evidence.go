package pluginsvc

import (
	"encoding/json"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"unicode"
)

// conformanceFuncByFamily names the one build-time conformance-pass
// function (called from conformStandard, never an activate/register-
// time validator) that proves a family, per maturity.go's doc-comment
// table. A family absent here has no conformance-pass function yet.
var conformanceFuncByFamily = map[string]string{
	"settings": "conformSettingDescriptions",
	"commands": "conformCommandNamespace",
	"themes":   "conformThemes",
}

// sdkTypeByFamily names the one generated plugin-api type that proves
// a family's runtime SDK surface exists, per maturity.go's doc-comment
// table. A family absent here is manifest-only: nothing to type.
var sdkTypeByFamily = map[string]string{
	"canvasObjects": "CanvasObjectDecl",
	"captures":      "PluginCaptureDecl",
	"views":         "PluginViewDecl",
	"commands":      "PluginCommandDecl",
	"themes":        "PluginThemeDecl",
	"settings":      "PluginSettingsAPI",
	"network":       "PluginFetchInit",
	"secretSources": "SecretSourceDecl",
}

// mcpByFamily names each family's MCP reachability, per maturity.go's
// doc-comment table. A family absent here is "no": nothing currently
// routes it to an agent.
var mcpByFamily = map[string]string{
	"settings":      "n/a",
	"network":       "n/a",
	"themes":        "n/a",
	"secretSources": "n/a",
	"commands":      "yes",
	"steps":         "yes",
	"tools":         "yes",
	"canvasObjects": "yes",
	"captures":      "n/a",
	"views":         "n/a",
}

func mcpFor(family string) string {
	if v, ok := mcpByFamily[family]; ok {
		return v
	}
	return "no"
}

// GatherEvidence reads repoRoot's own tree -- never the running
// process' own compiled-in knowledge -- so a family's evidence always
// reflects the checked-out commit, not whatever built this binary.
func GatherEvidence(repoRoot string) map[string]Evidence {
	out := make(map[string]Evidence)
	for _, family := range Families() {
		out[family] = Evidence{
			Conformance: hasConformanceFunc(repoRoot, family),
			Example:     hasExample(repoRoot, family),
			E2E:         hasE2E(repoRoot, family),
			Docs:        hasDocs(repoRoot, family),
			SDKTypes:    hasSDKType(repoRoot, family),
			MCP:         mcpFor(family),
		}
	}
	return out
}

// hasConformanceFunc scans every non-test pluginsvc/*.go file (not
// only conform*.go -- conformThemes itself lives in themes.go, see
// maturity.go's doc comment) for the family's mapped function
// definition.
func hasConformanceFunc(repoRoot, family string) bool {
	funcName, ok := conformanceFuncByFamily[family]
	if !ok {
		return false
	}
	dir := filepath.Join(repoRoot, "internal", "services", "pluginsvc")
	entries, err := os.ReadDir(dir)
	if err != nil {
		return false
	}
	re := regexp.MustCompile(`(?m)^func ` + regexp.QuoteMeta(funcName) + `\(`)
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".go") || strings.HasSuffix(entry.Name(), "_test.go") {
			continue
		}
		raw, err := os.ReadFile(filepath.Join(dir, entry.Name())) // #nosec G304 -- entry came from this same directory's own listing
		if err != nil {
			continue
		}
		if re.Match(raw) {
			return true
		}
	}
	return false
}

// hasExample reports whether any examples/plugins/*/manifest.json
// declares a non-empty contributes.<family>.
func hasExample(repoRoot, family string) bool {
	matches, err := filepath.Glob(filepath.Join(repoRoot, "examples", "plugins", "*", "manifest.json"))
	if err != nil {
		return false
	}
	for _, m := range matches {
		raw, err := os.ReadFile(m) // #nosec G304 -- m came from this fixed glob under the repo's own examples tree
		if err != nil {
			continue
		}
		var doc struct {
			Contributes map[string]json.RawMessage `json:"contributes"`
		}
		if err := json.Unmarshal(raw, &doc); err != nil {
			continue
		}
		raw, ok := doc.Contributes[family]
		if !ok {
			continue
		}
		var arr []json.RawMessage
		if err := json.Unmarshal(raw, &arr); err == nil && len(arr) > 0 {
			return true
		}
	}
	return false
}

// e2eRegisterTokenByFamily names the one SDK registration call that,
// found anywhere in an e2e spec, proves a family's runtime path ran
// for real -- never a bare English word a spec's prose could also
// contain (goal 0348 follow-up: "themes" and "steps" both matched
// unrelated comments under the old whole-word rule). A family absent
// here has no registration call of its own (settings/network/themes
// are declarative, per maturity.go's doc-comment table) and proves
// e2e coverage only through the contributes.<family> or fixture-
// manifest routes below.
var e2eRegisterTokenByFamily = map[string]string{
	"canvasObjects": "registerCanvasObject",
	"commands":      "registerCommand",
	"views":         "registerView",
	"captures":      "registerCapture",
}

// camelToKebab renders a Go-style camelCase family name (canvasObjects)
// as its kebab-case spec-filename form (canvas-objects); a family with
// no upper-case letter (commands, themes, ...) round-trips unchanged.
func camelToKebab(family string) string {
	var b strings.Builder
	for i, r := range family {
		if i > 0 && unicode.IsUpper(r) {
			b.WriteByte('-')
		}
		b.WriteRune(unicode.ToLower(r))
	}
	return b.String()
}

// hasE2E reports whether family has e2e evidence under any of three
// routes, per maturity.go's doc-comment table: a spec file named for
// the family, a spec file exercising its SDK registration call or
// literal contributes.<family> reference, or a fixture plugin
// declaring the contribution. Never a bare whole-word match on the
// family name -- English words like "steps", "views" and "themes"
// match unrelated prose, not the plugin door.
func hasE2E(repoRoot, family string) bool {
	dir := filepath.Join(repoRoot, "frontend", "e2e")
	for _, base := range []string{family, camelToKebab(family)} {
		matches, err := filepath.Glob(filepath.Join(dir, "runtime-plugin-"+base+"*.spec.ts"))
		if err == nil && len(matches) > 0 {
			return true
		}
	}

	tokens := []string{"contributes." + family}
	if tok, ok := e2eRegisterTokenByFamily[family]; ok {
		tokens = append(tokens, tok)
	}
	entries, err := os.ReadDir(dir)
	if err == nil {
		for _, entry := range entries {
			if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".spec.ts") {
				continue
			}
			raw, err := os.ReadFile(filepath.Join(dir, entry.Name())) // #nosec G304 -- entry came from this same directory's own listing
			if err != nil {
				continue
			}
			for _, tok := range tokens {
				if strings.Contains(string(raw), tok) {
					return true
				}
			}
		}
	}

	return hasFixtureManifestContribution(filepath.Join(repoRoot, "frontend", "e2e", "fixtures"), family)
}

// hasFixtureManifestContribution reports whether any manifest.json
// under fixturesDir (an e2e fixture plugin written to disk for a
// test, never examples/plugins -- that's the Example cell's own
// evidence) declares a non-empty contributes.<family>.
func hasFixtureManifestContribution(fixturesDir, family string) bool {
	found := false
	_ = filepath.WalkDir(fixturesDir, func(path string, d fs.DirEntry, err error) error {
		if err != nil || found || d.IsDir() || d.Name() != "manifest.json" {
			return nil
		}
		raw, readErr := os.ReadFile(path) // #nosec G304 G122 -- path came from this same walk under the repo's own fixtures tree, read-only evidence gathering never a privileged operation
		if readErr != nil {
			return nil
		}
		var doc struct {
			Contributes map[string]json.RawMessage `json:"contributes"`
		}
		if json.Unmarshal(raw, &doc) != nil {
			return nil
		}
		raw, ok := doc.Contributes[family]
		if !ok {
			return nil
		}
		var arr []json.RawMessage
		if json.Unmarshal(raw, &arr) == nil && len(arr) > 0 {
			found = true
		}
		return nil
	})
	return found
}

// maturityPageBasename is excluded from Docs evidence -- the generated
// ledger naming a family is not a hand-authored reference for it.
const maturityPageBasename = "plugin-api-maturity.md"

// hasDocs reports whether any userdocs/reference/*.md (excluding the
// generated maturity page) names the family key as a whole word.
func hasDocs(repoRoot, family string) bool {
	matches, err := filepath.Glob(filepath.Join(repoRoot, "userdocs", "reference", "*.md"))
	if err != nil {
		return false
	}
	re := regexp.MustCompile(`(?i)\b` + regexp.QuoteMeta(family) + `\b`)
	for _, m := range matches {
		if filepath.Base(m) == maturityPageBasename {
			continue
		}
		raw, err := os.ReadFile(m) // #nosec G304 -- m came from this fixed glob under the repo's own userdocs tree
		if err != nil {
			continue
		}
		if re.Match(raw) {
			return true
		}
	}
	return false
}

// hasSDKType reports whether the generated plugin-api reference tree
// carries a page for the family's mapped SDK type.
func hasSDKType(repoRoot, family string) bool {
	typeName, ok := sdkTypeByFamily[family]
	if !ok {
		return false
	}
	matches, err := filepath.Glob(filepath.Join(repoRoot, "userdocs", "reference", "plugin-api", "*", typeName+".md"))
	if err != nil {
		return false
	}
	return len(matches) > 0
}
