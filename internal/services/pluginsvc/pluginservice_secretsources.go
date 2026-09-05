package pluginsvc

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/alicoding/mill/internal/adapters/jsengine"
)

// The secret-source contribution family (goal 0306 S4, ADR-0048): a
// plugin DECLARES the stores it can read secrets out of, and
// IMPLEMENTS them in secrets.js -- the same declare-first shape steps
// take, and the same Go-side engine, never the webview. A plugin is a
// PRODUCER only: it hands the host a value it read itself, and the
// host applies that value through the unchanged provider path (the
// presence gate, the guardrail, the audit line). Nothing here grants a
// plugin command execution; a store reached through a command-line
// tool stays a Go adapter (internal/adapters/clisecrets), the posture
// ADR-0050 sets.

// SecretSourceContribution is one declared store: the id secrets.js
// registers, the label the Sources picker offers it under, how its
// path field renders, and which of the four functions it implements.
type SecretSourceContribution struct {
	ID    string                       `json:"id"`
	Label string                       `json:"label"`
	Path  SecretSourcePathContribution `json:"path"`
	// Capabilities names what secrets.js implements for this source:
	// "list" and "resolve" are mandatory, "discover" and "import"
	// optional. Declared rather than inferred so the Sources page can
	// offer a store's own discovery before any plugin code runs.
	Capabilities []string `json:"capabilities"`
}

// SecretSourcePathContribution declares the source's path field: a
// file to read, a folder to read under, or none at all -- with the
// label, placeholder and default the field renders with.
type SecretSourcePathContribution struct {
	Kind        string `json:"kind"`
	Label       string `json:"label"`
	Placeholder string `json:"placeholder"`
	Default     string `json:"default"`
}

// The path kinds and source capabilities, enumerated the same way the
// capability vocabulary is: an unknown one blocks the load.
const (
	SourcePathFile   = "file"
	SourcePathFolder = "folder"
	SourcePathNone   = "none"
)

const (
	sourceCapList     = "list"
	sourceCapResolve  = "resolve"
	sourceCapDiscover = "discover"
	sourceCapImport   = "import"
)

// sourceLabelLimit keeps a contributed label inside what the Sources
// picker's one-line option can show without truncating.
const sourceLabelLimit = 40

// SecretSourceKindPrefix opens secretsource.Kind to plugins: a source
// of kind "plugin:<pluginID>/<sourceID>" is answered by that plugin's
// secrets.js.
const SecretSourceKindPrefix = "plugin:"

// SecretSourceKind builds the kind string a configured source stores.
func SecretSourceKind(pluginID, sourceID string) string {
	return SecretSourceKindPrefix + pluginID + "/" + sourceID
}

// splitSecretSourceKind parses that kind back into its two ids.
func splitSecretSourceKind(kind string) (pluginID, sourceID string, ok bool) {
	rest, found := strings.CutPrefix(kind, SecretSourceKindPrefix)
	if !found {
		return "", "", false
	}
	pluginID, sourceID, found = strings.Cut(rest, "/")
	if !found || !pluginIDPattern.MatchString(pluginID) || !pluginIDPattern.MatchString(sourceID) {
		return "", "", false
	}
	return pluginID, sourceID, true
}

// validateSecretSources fail-closes the family the same way every
// other contributes.* validator does. A plugin declaring a source must
// also declare the "read-file" capability: every source function's one
// door to the machine is ctx.readFile / ctx.listFiles, so a source
// without it could never answer.
func validateSecretSources(capabilities []string, sources []SecretSourceContribution) string {
	if len(sources) == 0 {
		return ""
	}
	declared := false
	for _, c := range capabilities {
		declared = declared || c == capabilityReadFile
	}
	if !declared {
		return fmt.Sprintf("contributed secret sources need the %q capability in the manifest", capabilityReadFile)
	}
	seen := map[string]bool{}
	for _, src := range sources {
		if problem := validateOneSecretSource(src, seen); problem != "" {
			return problem
		}
		seen[src.ID] = true
	}
	return ""
}

func validateOneSecretSource(src SecretSourceContribution, seen map[string]bool) string {
	if !pluginIDPattern.MatchString(src.ID) {
		return fmt.Sprintf("contributed secret source id %q must be lowercase letters, digits, and hyphens", src.ID)
	}
	if seen[src.ID] {
		return fmt.Sprintf("contributed secret source %q is declared twice", src.ID)
	}
	if label := strings.TrimSpace(src.Label); label == "" {
		return fmt.Sprintf("contributed secret source %q needs a label", src.ID)
	} else if len(label) > sourceLabelLimit {
		return fmt.Sprintf("contributed secret source %q label must be %d characters or fewer", src.ID, sourceLabelLimit)
	}
	switch src.Path.Kind {
	case SourcePathFile, SourcePathFolder, SourcePathNone:
	default:
		return fmt.Sprintf("contributed secret source %q path kind %q must be \"file\", \"folder\", or \"none\"", src.ID, src.Path.Kind)
	}
	if src.Path.Kind != SourcePathNone && strings.TrimSpace(src.Path.Label) == "" {
		return fmt.Sprintf("contributed secret source %q needs a path label", src.ID)
	}
	return validateSecretSourceCapabilities(src)
}

func validateSecretSourceCapabilities(src SecretSourceContribution) string {
	has := map[string]bool{}
	for _, c := range src.Capabilities {
		switch c {
		case sourceCapList, sourceCapResolve, sourceCapDiscover, sourceCapImport:
		default:
			return fmt.Sprintf("contributed secret source %q capability %q must be \"list\", \"resolve\", \"discover\", or \"import\"", src.ID, c)
		}
		has[c] = true
	}
	if !has[sourceCapList] || !has[sourceCapResolve] {
		return fmt.Sprintf("contributed secret source %q must declare the \"list\" and \"resolve\" capabilities", src.ID)
	}
	if has[sourceCapDiscover] && src.Path.Kind == SourcePathFile {
		return fmt.Sprintf("contributed secret source %q can only discover under a \"folder\" or \"none\" path", src.ID)
	}
	return ""
}

// secretsFileProblem checks that a plugin declaring secret sources
// ships secrets.js -- the loader's twin of stepsFileProblem.
func secretsFileProblem(dir string, m Manifest) string {
	if len(m.Contributes.SecretSources) == 0 {
		return ""
	}
	if _, err := os.Stat(filepath.Join(dir, secretsPackFile)); err != nil { // #nosec G703 -- dir is this service's own plugins root joined with a validated id
		return "secrets.js is missing (the manifest declares secret sources)"
	}
	return ""
}

// conformSecretSourcePack is the conformance suite's half: the
// declared sources and secrets.js must agree both ways, and a declared
// optional capability must actually be implemented.
func conformSecretSourcePack(dir string, m Manifest) []string {
	if len(m.Contributes.SecretSources) == 0 {
		return nil
	}
	raw, err := os.ReadFile(filepath.Join(dir, secretsPackFile)) // #nosec G304 -- the caller's own plugin folder
	if err != nil {
		return []string{"secrets.js is missing (the manifest declares secret sources)"}
	}
	pack, err := jsengine.LoadSources(string(raw), jsengine.DefaultTimeout)
	if err != nil {
		return []string{err.Error()}
	}
	declared := map[string]SecretSourceContribution{}
	for _, src := range m.Contributes.SecretSources {
		declared[src.ID] = src
	}
	var problems []string
	registered := map[string]bool{}
	for _, d := range pack.Sources() {
		registered[d.ID] = true
		src, ok := declared[d.ID]
		if !ok {
			problems = append(problems, fmt.Sprintf("secrets.js registers the source %q, which the manifest does not declare", d.ID))
			continue
		}
		problems = append(problems, sourceCapabilityGaps(src, d)...)
	}
	for id := range declared {
		if !registered[id] {
			problems = append(problems, fmt.Sprintf("the manifest declares the secret source %q, which secrets.js does not register", id))
		}
	}
	return problems
}

func sourceCapabilityGaps(src SecretSourceContribution, d jsengine.SourceDecl) []string {
	var problems []string
	for _, pair := range []struct {
		capability string
		present    bool
	}{{sourceCapDiscover, d.HasDiscover}, {sourceCapImport, d.HasImport}} {
		wants := false
		for _, c := range src.Capabilities {
			wants = wants || c == pair.capability
		}
		if wants && !pair.present {
			problems = append(problems, fmt.Sprintf("the secret source %q declares %q, which secrets.js does not implement", src.ID, pair.capability))
		}
		if !wants && pair.present {
			problems = append(problems, fmt.Sprintf("secrets.js implements %q for the source %q, which the manifest does not declare", pair.capability, src.ID))
		}
	}
	return problems
}
