package pluginsvc

import (
	"fmt"
	"regexp"
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
	return validateSettingContributions(c.Settings)
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
