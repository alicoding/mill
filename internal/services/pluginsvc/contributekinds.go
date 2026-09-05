package pluginsvc

import (
	"reflect"
	"strings"
)

// What a manifest contributes, as a LIST rather than a hand-kept
// enumeration (docs/goals/0349). ManifestContributes' own json tags
// are the vocabulary: adding a contribution family to that struct puts
// a filter chip in the Extensions list and a line in the install
// prompt with no second place to edit -- the same reflective read the
// maturity ledger takes over its own registry.

// ContributionKindNames lists every family a manifest can contribute
// to, in declaration order. Bound so the list's filter chips are built
// from the real vocabulary rather than a frontend copy of it.
func ContributionKindNames() []string {
	t := reflect.TypeOf(ManifestContributes{})
	out := make([]string, 0, t.NumField())
	for i := 0; i < t.NumField(); i++ {
		if name := jsonFieldName(t.Field(i)); name != "" {
			out = append(out, name)
		}
	}
	return out
}

// ContributionKinds names the families THIS manifest actually fills,
// in the same declaration order.
func contributionKinds(c ManifestContributes) []string {
	v := reflect.ValueOf(c)
	t := v.Type()
	out := []string{}
	for i := 0; i < t.NumField(); i++ {
		field := v.Field(i)
		if field.Kind() != reflect.Slice || field.Len() == 0 {
			continue
		}
		if name := jsonFieldName(t.Field(i)); name != "" {
			out = append(out, name)
		}
	}
	return out
}

func jsonFieldName(f reflect.StructField) string {
	tag := f.Tag.Get("json")
	if tag == "" || tag == "-" {
		return ""
	}
	name, _, _ := strings.Cut(tag, ",")
	return name
}

// ContributionKindsFor answers one installed plugin's filled families,
// so the list can filter by them without re-deriving the rule.
func (p *PluginService) ContributionKindsFor(id string) ([]string, error) {
	return contributionKinds(p.resolvePlugin(id).Manifest.Contributes), nil
}

// ContributionVocabulary is the bound form of ContributionKindNames.
func (p *PluginService) ContributionVocabulary() ([]string, error) {
	return ContributionKindNames(), nil
}
