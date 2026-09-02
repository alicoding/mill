package pluginsvc

import (
	"fmt"
	"regexp"
	"strings"
)

// The manifest's contributes.settings half (docs/goals/0258 slice 1):
// the declared-setting contribution types and their fail-closed
// validation, split from pluginservice.go along the contribution-point
// seam (the file-size convention). Values are never stored here --
// settingssvc's extension-settings blob holds them; this file only
// pins what a plugin may DECLARE.

// SettingContribution is one declared plugin setting. Type is the
// four-type floor every declarative settings platform shares:
// "boolean", "string", "number", "enum". Default is the value in
// effect until the user touches the control (the converged
// `default` spelling), decoded as whatever JSON scalar the manifest
// wrote; validateContributes pins it to Type. Options is enum-only;
// Min/Max are number-only, both optional.
type SettingContribution struct {
	Key         string          `json:"key"`
	Type        string          `json:"type"`
	Label       string          `json:"label"`
	Description string          `json:"description"`
	Default     any             `json:"default"`
	Options     []SettingOption `json:"options"`
	Min         *float64        `json:"min"`
	Max         *float64        `json:"max"`
}

// SettingOption is one enum choice: the stored value and its
// user-facing label.
type SettingOption struct {
	Value string `json:"value"`
	Label string `json:"label"`
}

// CanvasObjectContribution claims the ingestion doors for one canvas
// object kind: which dropped-file extensions and which clipboard
// shapes land as this plugin's object. Payload shape is not declared
// here -- it derives from the object's own registered source (a
// fileExtensions claim requires a file-backed object landing
// mirrorPath+title; PastesURLs requires a url-backed one landing
// url+title), enforced host-side at registration.
type CanvasObjectContribution struct {
	Kind           string   `json:"kind"`
	FileExtensions []string `json:"fileExtensions"`
	PastesURLs     bool     `json:"pastesURLs"`
}

// settingKeyPattern pins a setting key to the identifier shape the
// frontend store and the SDK address it by (camelCase or kebab, no
// spaces/dots -- a dot would read as nesting in the blob).
var settingKeyPattern = regexp.MustCompile(`^[a-zA-Z][a-zA-Z0-9_-]{0,63}$`)

// validateSettingContribution fail-closes one declared setting: the
// key, the type, a default of that type, enum options with the
// default among them, and a sane min/max -- each with the reason a
// plugin author can act on.
func validateSettingContribution(st SettingContribution) string {
	if !settingKeyPattern.MatchString(st.Key) {
		return fmt.Sprintf("contributed setting key %q must start with a letter and use only letters, digits, - and _", st.Key)
	}
	if strings.TrimSpace(st.Label) == "" {
		return fmt.Sprintf("contributed setting %q needs a label", st.Key)
	}
	switch st.Type {
	case "boolean":
		if _, ok := st.Default.(bool); !ok {
			return fmt.Sprintf("contributed setting %q is a boolean but its default is not true or false", st.Key)
		}
	case "string":
		if _, ok := st.Default.(string); !ok {
			return fmt.Sprintf("contributed setting %q is a string but its default is not a string", st.Key)
		}
	case "number":
		return validateNumberSetting(st)
	case "enum":
		return validateEnumSetting(st)
	default:
		return fmt.Sprintf("contributed setting %q has unknown type %q (boolean, string, number, or enum)", st.Key, st.Type)
	}
	return ""
}

func validateNumberSetting(st SettingContribution) string {
	def, ok := st.Default.(float64)
	if !ok {
		return fmt.Sprintf("contributed setting %q is a number but its default is not a number", st.Key)
	}
	if st.Min != nil && st.Max != nil && *st.Min > *st.Max {
		return fmt.Sprintf("contributed setting %q has min above max", st.Key)
	}
	if (st.Min != nil && def < *st.Min) || (st.Max != nil && def > *st.Max) {
		return fmt.Sprintf("contributed setting %q has a default outside its min/max", st.Key)
	}
	return ""
}

func validateEnumSetting(st SettingContribution) string {
	def, ok := st.Default.(string)
	if !ok {
		return fmt.Sprintf("contributed setting %q is an enum but its default is not a string", st.Key)
	}
	if len(st.Options) == 0 {
		return fmt.Sprintf("contributed setting %q is an enum but declares no options", st.Key)
	}
	found := false
	for _, o := range st.Options {
		if strings.TrimSpace(o.Value) == "" || strings.TrimSpace(o.Label) == "" {
			return fmt.Sprintf("contributed setting %q has an option missing its value or label", st.Key)
		}
		if o.Value == def {
			found = true
		}
	}
	if !found {
		return fmt.Sprintf("contributed setting %q has a default that is not one of its options", st.Key)
	}
	return ""
}
