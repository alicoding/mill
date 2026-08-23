package atlas

import (
	"sort"
	"strings"

	"github.com/alicoding/mill/internal/domain/typedfield"
)

// smallRepeatingSetMaxDistinct/smallRepeatingSetMinRepeatFactor mirror
// the List import's own inference thresholds
// (frontend/src/configure/listRowImportParse.ts's inferListSchema) --
// adopted rather than re-derived, per goal 0172 S2's design contract:
// the heuristics are shared, only the implementation site (Go, over
// YAML-native values, instead of TS over CSV strings) differs.
const (
	smallRepeatingSetMaxDistinct     = 8
	smallRepeatingSetMinRepeatFactor = 2
)

// InferFrontmatterFields proposes a Kind's typed fields from the union
// of frontmatter observed across perFile -- goal 0172 S2's "create a
// new type from these files" proposal. perFile is one raw
// ParseFrontmatter map per file that had readable frontmatter; a key
// missing from a given file simply doesn't contribute a value from
// that file. Every key across every file is proposed -- callers filter
// with the panel's own "Include" checkbox, not this function.
//
// Precedence per key, applied to every non-nil value observed for that
// key (nil/absent never votes, same as List import's empty-cell rule):
//  1. every value a YAML native bool -> TypeBoolean
//  2. else every value a YAML native number -> TypeNumber
//  3. else any value a YAML list -> TypeText with Multiline (list items
//     join ", " at coercion time -- TypeArray isn't card-renderable)
//  4. else a small repeating distinct set (<=8 distinct, values >= 2x
//     distinct) of the values' own string form -> TypeOptions
//  5. else -> TypeText
//
// A YAML-timestamp-shaped value (an unquoted date in the header) is
// NEVER special-cased into TypeDate: typedfield.TypeDate exists in the
// domain, but the card surface doesn't render it, so a date-looking
// value falls through these same rules like any other scalar and lands
// on TypeText (or TypeOptions, if it happens to repeat across files).
//
// Key order is alphabetical -- a map has no source-key order to
// preserve, so this is the only order that's actually deterministic.
// Only the first field whose inferred type is TypeOptions gets
// ShowOnCard: true (options is the only type the card face renders as
// a pill, and the face caps at three fields).
func InferFrontmatterFields(perFile []map[string]any) []typedfield.Field {
	values := map[string][]any{}
	for _, fm := range perFile {
		for k, v := range fm {
			if v == nil {
				continue
			}
			values[k] = append(values[k], v)
		}
	}

	keys := make([]string, 0, len(values))
	for k := range values {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	fields := make([]typedfield.Field, 0, len(keys))
	optionsAssigned := false
	for _, key := range keys {
		f := typedfield.Field{Key: key, Label: humanizeFrontmatterKey(key)}
		f.Type, f.Multiline, f.Options = inferValueShape(values[key])
		if f.Type == typedfield.TypeOptions && !optionsAssigned {
			f.ShowOnCard = true
			optionsAssigned = true
		}
		fields = append(fields, f)
	}
	return fields
}

// inferValueShape applies InferFrontmatterFields' own precedence rules
// to one key's observed values.
func inferValueShape(vals []any) (typ typedfield.Type, multiline bool, options []string) {
	if allBoolValues(vals) {
		return typedfield.TypeBoolean, false, nil
	}
	if allNumberValues(vals) {
		return typedfield.TypeNumber, false, nil
	}
	if anyListValue(vals) {
		return typedfield.TypeText, true, nil
	}
	strs := make([]string, len(vals))
	for i, v := range vals {
		strs[i] = coerceFrontmatterScalar(v)
	}
	if opts, ok := smallRepeatingStringSet(strs); ok {
		return typedfield.TypeOptions, false, opts
	}
	return typedfield.TypeText, false, nil
}

func allBoolValues(vals []any) bool {
	for _, v := range vals {
		if _, ok := v.(bool); !ok {
			return false
		}
	}
	return true
}

func allNumberValues(vals []any) bool {
	for _, v := range vals {
		switch v.(type) {
		case int, int64, float64:
		default:
			return false
		}
	}
	return true
}

func anyListValue(vals []any) bool {
	for _, v := range vals {
		if _, ok := v.([]any); ok {
			return true
		}
	}
	return false
}

// smallRepeatingStringSet reports whether strs' distinct-value set is
// small enough, and repeats enough, to propose as TypeOptions -- the
// exact List-import threshold (inferListSchema), adopted rather than
// reimplemented per this function's own doc comment. Preserves first-
// seen order in the returned option list.
func smallRepeatingStringSet(strs []string) ([]string, bool) {
	var distinct []string
	seen := map[string]bool{}
	for _, s := range strs {
		if !seen[s] {
			seen[s] = true
			distinct = append(distinct, s)
		}
	}
	if len(distinct) == 0 || len(distinct) > smallRepeatingSetMaxDistinct {
		return nil, false
	}
	if len(strs) < len(distinct)*smallRepeatingSetMinRepeatFactor {
		return nil, false
	}
	return distinct, true
}

// humanizeFrontmatterKey turns a raw frontmatter key into a proposed
// field Label -- sentence case, only the first word capitalized
// ("released_on" -> "Released on"), unlike HumanizeFilename's title
// case (every word capitalized), since a Kind field Label reads as a
// short phrase, not a document title.
func humanizeFrontmatterKey(key string) string {
	words := strings.FieldsFunc(key, func(r rune) bool { return r == '-' || r == '_' || r == ' ' })
	if len(words) == 0 {
		return key
	}
	for i, w := range words {
		words[i] = strings.ToLower(w)
	}
	words[0] = capitalizeWord(words[0])
	return strings.Join(words, " ")
}
