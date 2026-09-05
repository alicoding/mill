package pluginsvc

import (
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"strings"
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
	"canvasObjects": "no",
	"captures":      "no",
	"views":         "no",
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

// hasE2E reports whether any frontend/e2e/*.spec.ts either is named
// runtime-plugin-<family>.spec.ts or contains the family key as a
// whole word.
func hasE2E(repoRoot, family string) bool {
	dir := filepath.Join(repoRoot, "frontend", "e2e")
	if _, err := os.Stat(filepath.Join(dir, "runtime-plugin-"+family+".spec.ts")); err == nil {
		return true
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return false
	}
	re := regexp.MustCompile(`\b` + regexp.QuoteMeta(family) + `\b`)
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".spec.ts") {
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
