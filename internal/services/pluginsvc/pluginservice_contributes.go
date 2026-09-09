package pluginsvc

import (
	"fmt"
	"path"
	"regexp"
	"strings"
)

// The manifest's contributes.* fail-closed validation, split from
// pluginservice.go along the file-size convention: a malformed
// contribution blocks the LOAD with a human-readable reason, never
// routes half-right.

// fileExtensionPattern pins a contributed extension claim to the
// ".ext" shape the drop router compares against (unitRegistry's own
// extensionOf yields a lowercased dot-prefixed extension).
var fileExtensionPattern = regexp.MustCompile(`^\.[a-z0-9]+$`)

// validateContributes fail-closes ingestion claims the same way an
// unknown capability does: a malformed claim blocks the load with a
// human-readable reason, never routes half-right.
func validateContributes(pluginID string, capabilities []string, c ManifestContributes) string {
	if problem := settingsAliasProblem(c); problem != "" {
		return problem
	}
	if problem := validateMenus(c.Menus); problem != "" {
		return problem
	}
	if problem := validateCanvasObjectContributions(c.CanvasObjects); problem != "" {
		return problem
	}
	if problem := validateNetwork(c.Network); problem != "" {
		return problem
	}
	if problem := validateSteps(c.Steps); problem != "" {
		return problem
	}
	if problem := validateCaptures(c.Captures); problem != "" {
		return problem
	}
	if problem := validateViews(c.Views); problem != "" {
		return problem
	}
	if problem := validateCommands(pluginID, c.Commands); problem != "" {
		return problem
	}
	if problem := validateTools(c); problem != "" {
		return problem
	}
	if problem := validateThemes(c.Themes); problem != "" {
		return problem
	}
	if problem := validateSecretSources(capabilities, c.SecretSources); problem != "" {
		return problem
	}
	if problem := validateMCPServers(c.EffectiveSettings(), c.MCPServers); problem != "" {
		return problem
	}
	return validateSettingContributions(c.EffectiveSettings())
}

func validateCanvasObjectContributions(objects []CanvasObjectContribution) string {
	for _, obj := range objects {
		if !pluginIDPattern.MatchString(obj.Kind) {
			return fmt.Sprintf("contributed canvas object kind %q must be lowercase letters, digits, and hyphens", obj.Kind)
		}
		for _, ext := range obj.FileExtensions {
			if !fileExtensionPattern.MatchString(ext) {
				return fmt.Sprintf("contributed file extension %q must look like \".ext\" in lowercase", ext)
			}
		}
		if problem := entryPathProblem("canvas object", obj.Kind, obj.Entry); problem != "" {
			return problem
		}
		if problem := validateCanvasObjectExample(obj.Kind, obj.Example); problem != "" {
			return problem
		}
	}
	return ""
}

// validateCanvasObjectExample fail-closes a declared example (goal
// 0411): nil is legal (a kind that ships none yet), but a declared one
// must be complete enough for the host to seed and to insert with --
// a title to show, a revision to reconcile against, and every fixture
// naming a supported kind, real content, and a payload key the host
// can inject its created id at.
func validateCanvasObjectExample(kind string, ex *CanvasObjectExample) string {
	if ex == nil {
		return ""
	}
	if strings.TrimSpace(ex.Title) == "" {
		return fmt.Sprintf("canvas object %q example needs a title", kind)
	}
	if ex.Revision < 1 {
		return fmt.Sprintf("canvas object %q example needs a revision of 1 or more", kind)
	}
	for _, f := range ex.Fixtures {
		if f.Kind != "note" {
			return fmt.Sprintf("canvas object %q example fixture has unknown kind %q (only \"note\" is declarable today)", kind, f.Kind)
		}
		if strings.TrimSpace(f.Body) == "" {
			return fmt.Sprintf("canvas object %q example fixture needs a body", kind)
		}
		if !settingKeyPattern.MatchString(f.PayloadKey) {
			return fmt.Sprintf("canvas object %q example fixture payloadKey %q must start with a letter and use only letters, digits, - and _", kind, f.PayloadKey)
		}
	}
	return ""
}

func validateSettingContributions(settings []SettingContribution) string {
	seen := map[string]bool{}
	for _, st := range settings {
		if problem := validateSettingContribution(st); problem != "" {
			return problem
		}
		if seen[st.Key] {
			return fmt.Sprintf("contributed setting %q is declared twice", st.Key)
		}
		seen[st.Key] = true
	}
	return ""
}

// Framed views and captures (docs/goals/0349, docs/adr/0047): a view or
// capture may declare an `entry` page instead of registering a render
// callback. The page is served by the asset route out of the plugin's
// own folder and mounted in a sandboxed frame, so the path must be a
// plain relative .html file inside that folder -- never absolute,
// never traversing out of it, never a scheme the frame would fetch
// from somewhere Mill does not serve.
func entryPathProblem(kind, id, entry string) string {
	if entry == "" {
		return ""
	}
	if !strings.HasSuffix(strings.ToLower(entry), ".html") {
		return fmt.Sprintf("contributed %s %q entry %q must be an .html file", kind, id, entry)
	}
	clean := path.Clean(entry)
	escapes := clean == ".." || strings.HasPrefix(clean, "../") || path.IsAbs(entry) ||
		strings.Contains(entry, "\\") || strings.Contains(entry, "://")
	if escapes {
		return fmt.Sprintf("contributed %s %q entry %q must be a file inside the plugin folder", kind, id, entry)
	}
	return ""
}

// entryFileProblem is the load-blocking existence check for every
// declared entry page, the twin of stepsFileProblem: exists reports
// whether one folder-relative path is present, so the scanned-folder
// and embedded-bundle scans share this one rule.
func entryFileProblem(m Manifest, exists func(rel string) bool) string {
	for _, v := range m.Contributes.Views {
		if v.Entry != "" && !exists(v.Entry) {
			return fmt.Sprintf("view %q entry %q is missing", v.ID, v.Entry)
		}
	}
	for _, c := range m.Contributes.Captures {
		if c.Entry != "" && !exists(c.Entry) {
			return fmt.Sprintf("capture %q entry %q is missing", c.ID, c.Entry)
		}
	}
	for _, o := range m.Contributes.CanvasObjects {
		if o.Entry != "" && !exists(o.Entry) {
			return fmt.Sprintf("canvas object %q entry %q is missing", o.Kind, o.Entry)
		}
	}
	return ""
}
