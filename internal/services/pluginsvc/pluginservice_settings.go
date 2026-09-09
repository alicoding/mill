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
// four-type floor every declarative settings platform shares --
// "boolean", "string", "number", "enum" -- plus "secretRef" (ADR-0048)
// and "entityRef" (docs/goals/0400): the user picks any reference the
// picker offers -- a vault entry or a configured source's key for
// secretRef (goal 0408 S1), a Configure entity of EntityKind for
// entityRef -- the stored value is that reference, and a secretRef
// plugin only ever reads its title (an entityRef plugin reads the id
// itself, the same value the picker stored). Default is the value in
// effect until the user touches the control (the converged
// `default` spelling), decoded as whatever JSON scalar the manifest
// wrote; validateContributes pins it to Type. Options is enum-only;
// Min/Max are number-only; EntityKind is entityRef-only -- all
// optional otherwise.
type SettingContribution struct {
	Key         string          `json:"key"`
	Type        string          `json:"type"`
	Label       string          `json:"label"`
	Description string          `json:"description"`
	Default     any             `json:"default"`
	Options     []SettingOption `json:"options"`
	Min         *float64        `json:"min"`
	Max         *float64        `json:"max"`
	// EntityKind names which Configure entity kind an entityRef setting
	// points at -- one of entityKindVocabulary below, the same RefKind
	// vocabulary frontend/src/configure/EntityRefField.tsx's own
	// fetchEntities switch resolves to a live picker.
	EntityKind string `json:"entityKind"`
}

// SettingTypeSecretRef is the vault-reference setting type (ADR-0048).
const SettingTypeSecretRef = "secretRef"

// SettingTypeEntityRef is the Configure-entity-reference setting type
// (docs/goals/0400): the stored value is the entity's id, picked
// through the same EntityRefField the ConfigField picker for that
// RefKind already uses.
const SettingTypeEntityRef = "entityRef"

// entityKindVocabulary is the RefKind vocabulary an entityRef setting
// may declare -- exactly the kinds
// frontend/src/configure/EntityRefField.tsx's own fetchEntities switch
// resolves to a live picker. Kept as an explicit Go-side copy (that
// frontend switch is the only other place this set is written) since a
// manifest naming any other kind would render a picker with nothing to
// select from -- standard rule 33.
var entityKindVocabulary = map[string]bool{
	"request": true, "list": true, "mcpserver": true, "workflow": true,
	"workflow-scope": true, "decision": true, "execenv": true,
	"environment": true, "aiprovider": true, "conversionprofile": true,
	"atlas-kind": true, "atlas-linkkind": true,
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
	// Entry names an .html page inside the plugin folder that draws
	// this kind's board face in its own sandboxed frame (goal 0349
	// S6); empty means the legacy renderFace form drawn into Mill's
	// own document.
	Entry string `json:"entry"`
	// Example declares this kind's own working example (goal 0411):
	// what a fresh install's Board gallery seeds and what an
	// empty-payload insert materializes before the first renderFace.
	// Nil for a kind that ships none yet -- a bundled/example plugin
	// without one fails conform_test.go's own repo-wide check; a
	// third-party one only gets an Extensions-pane warning, never a
	// load refusal.
	Example *CanvasObjectExample `json:"example"`
}

// CanvasObjectExample is one canvas-object kind's declared working
// example (goal 0411, docs/goals/0411 Amendment). Payload is the
// object's own payload once every Fixture's created id has been
// injected at its own PayloadKey; Title names the Board gallery's
// seeded copy; Revision is this example's own seed revision -- the
// same "bump to re-seed a fresh copy on top-up" convention every other
// golden's Seed field already carries, read by atlassvc's own
// reconcile (adapted across the service seam by wiring.go, never a
// direct pluginsvc import into atlassvc).
type CanvasObjectExample struct {
	Title    string                       `json:"title"`
	Payload  map[string]string            `json:"payload"`
	Revision int                          `json:"revision"`
	Fixtures []CanvasObjectExampleFixture `json:"fixtures"`
}

// CanvasObjectExampleFixture is one piece of content an example
// insert/seed creates ahead of the object itself. "note" is the only
// declarable Kind today (ADR-0047's deferred-capability vocabulary
// grows this as a real second kind needs it); PayloadKey names where
// the created fixture's own id lands in CanvasObjectExample.Payload.
type CanvasObjectExampleFixture struct {
	Kind string `json:"kind"`
	// Title documents the fixture's own intent for a future fixture
	// kind that carries a real title field; a "note" fixture derives
	// its own title from Body's first line (atlas.Note has none of its
	// own), so this is not read when creating one.
	Title      string `json:"title"`
	Body       string `json:"body"`
	PayloadKey string `json:"payloadKey"`
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
	case SettingTypeSecretRef:
		// No default can name a vault entry the manifest author never
		// saw; the unset state is "no secret picked".
		if st.Default != nil {
			return fmt.Sprintf("contributed setting %q is a secretRef and cannot declare a default", st.Key)
		}
	case SettingTypeEntityRef:
		return validateEntityRefSetting(st)
	default:
		return fmt.Sprintf("contributed setting %q has unknown type %q (boolean, string, number, enum, secretRef, or entityRef)", st.Key, st.Type)
	}
	return ""
}

// validateEntityRefSetting is standard rule 33: an entityRef setting
// names a known entityKind, and (matching secretRef's own reasoning)
// declares no default -- no manifest author ever saw the live
// Configure entity a default would have to name.
func validateEntityRefSetting(st SettingContribution) string {
	if st.Default != nil {
		return fmt.Sprintf("contributed setting %q is an entityRef and cannot declare a default", st.Key)
	}
	if strings.TrimSpace(st.EntityKind) == "" {
		return fmt.Sprintf("contributed setting %q is an entityRef but declares no entityKind (standard rule 33)", st.Key)
	}
	if !entityKindVocabulary[st.EntityKind] {
		return fmt.Sprintf("contributed setting %q has entityKind %q, which is not a Configure entity kind the picker supports (standard rule 33)", st.Key, st.EntityKind)
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

// viewPlacements is the enumerated placement vocabulary
// (docs/goals/0357): "" and "tab" both mean an ordinary work tab
// (omitted = today's behavior); "board-switcher" lists the view in the
// Atlas board's own view switcher, after Mill's four core entries.
var viewPlacements = map[string]bool{"": true, "tab": true, "board-switcher": true}

// validateViews fail-closes contributes.views (docs/goals/0290): a
// view needs a slug id, unique within the plugin, and a title.
func validateViews(views []ViewContribution) string {
	seen := map[string]bool{}
	for _, v := range views {
		if !pluginIDPattern.MatchString(v.ID) {
			return fmt.Sprintf("contributed view id %q must be lowercase letters, digits, and hyphens", v.ID)
		}
		if strings.TrimSpace(v.Title) == "" {
			return fmt.Sprintf("contributed view %q needs a title", v.ID)
		}
		if seen[v.ID] {
			return fmt.Sprintf("contributed view %q is declared twice", v.ID)
		}
		if !viewPlacements[v.Placement] {
			return fmt.Sprintf("contributed view %q has an unknown placement %q (tab or board-switcher)", v.ID, v.Placement)
		}
		if problem := entryPathProblem("view", v.ID, v.Entry); problem != "" {
			return problem
		}
		seen[v.ID] = true
	}
	return ""
}
