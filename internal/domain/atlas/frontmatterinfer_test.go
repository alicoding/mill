package atlas

import (
	"reflect"
	"testing"
	"time"

	"github.com/alicoding/mill/internal/domain/typedfield"
)

func fieldByKey(t *testing.T, fields []typedfield.Field, key string) typedfield.Field {
	t.Helper()
	for _, f := range fields {
		if f.Key == key {
			return f
		}
	}
	t.Fatalf("no field with key %q among %+v", key, fields)
	return typedfield.Field{}
}

func TestInferFrontmatterFields_EmptyInputProducesNoFields(t *testing.T) {
	if got := InferFrontmatterFields(nil); len(got) != 0 {
		t.Errorf("InferFrontmatterFields(nil) = %+v, want empty", got)
	}
	if got := InferFrontmatterFields([]map[string]any{{}, {}}); len(got) != 0 {
		t.Errorf("InferFrontmatterFields(no keys) = %+v, want empty", got)
	}
}

func TestInferFrontmatterFields_AllBooleanValuesInferBoolean(t *testing.T) {
	got := InferFrontmatterFields([]map[string]any{
		{"reviewed": true}, {"reviewed": false},
	})
	f := fieldByKey(t, got, "reviewed")
	if f.Type != typedfield.TypeBoolean {
		t.Errorf("Type = %q, want boolean", f.Type)
	}
}

func TestInferFrontmatterFields_AllNumericValuesInferNumber(t *testing.T) {
	got := InferFrontmatterFields([]map[string]any{
		{"priority": 1}, {"priority": 2.5}, {"priority": int64(3)},
	})
	f := fieldByKey(t, got, "priority")
	if f.Type != typedfield.TypeNumber {
		t.Errorf("Type = %q, want number", f.Type)
	}
}

func TestInferFrontmatterFields_AnyListValueInfersMultilineText(t *testing.T) {
	got := InferFrontmatterFields([]map[string]any{
		{"tags": []any{"a", "b"}},
		{"tags": []any{"c"}},
	})
	f := fieldByKey(t, got, "tags")
	if f.Type != typedfield.TypeText || !f.Multiline {
		t.Errorf("tags field = %+v, want TypeText with Multiline=true", f)
	}
}

func TestInferFrontmatterFields_SmallRepeatingStringSetInfersOptions(t *testing.T) {
	got := InferFrontmatterFields([]map[string]any{
		{"status": "open"}, {"status": "closed"}, {"status": "open"}, {"status": "open"},
	})
	f := fieldByKey(t, got, "status")
	if f.Type != typedfield.TypeOptions {
		t.Errorf("Type = %q, want options", f.Type)
	}
	want := []string{"open", "closed"}
	if !reflect.DeepEqual(f.Options, want) {
		t.Errorf("Options = %v, want %v (first-seen order)", f.Options, want)
	}
}

// Regression pin for the List-import-adopted threshold: too many
// distinct values, or too few repeats relative to the distinct count,
// must fall through to plain text rather than an unusable options list.
func TestInferFrontmatterFields_LargeOrNonRepeatingStringSetInfersText(t *testing.T) {
	manyDistinct := []map[string]any{}
	for i := 0; i < 10; i++ {
		manyDistinct = append(manyDistinct, map[string]any{"owner": string(rune('a' + i))})
	}
	got := InferFrontmatterFields(manyDistinct)
	if f := fieldByKey(t, got, "owner"); f.Type != typedfield.TypeText {
		t.Errorf("10-distinct owner field Type = %q, want text (over the 8-distinct cap)", f.Type)
	}

	notRepeating := []map[string]any{
		{"handle": "alice"}, {"handle": "bob"}, {"handle": "carol"},
	}
	got = InferFrontmatterFields(notRepeating)
	if f := fieldByKey(t, got, "handle"); f.Type != typedfield.TypeText {
		t.Errorf("3-distinct/3-value handle field Type = %q, want text (values < 2x distinct)", f.Type)
	}
}

// Pins the design contract's explicit correction: typedfield.TypeDate
// exists but the card surface can't render it, so a YAML-timestamp-
// shaped value must never be proposed as TypeDate -- it falls through
// to plain text like any other non-repeating scalar.
func TestInferFrontmatterFields_DateShapedValueNeverInfersDateType(t *testing.T) {
	got := InferFrontmatterFields([]map[string]any{
		{"released": time.Date(2026, 1, 15, 0, 0, 0, 0, time.UTC)},
		{"released": time.Date(2026, 2, 1, 0, 0, 0, 0, time.UTC)},
	})
	f := fieldByKey(t, got, "released")
	if f.Type == typedfield.TypeDate {
		t.Fatalf("released field inferred TypeDate -- never allowed, the card surface can't render it")
	}
	if f.Type != typedfield.TypeText {
		t.Errorf("released field Type = %q, want text for two distinct dates", f.Type)
	}
}

func TestInferFrontmatterFields_NilValuesNeverVote(t *testing.T) {
	got := InferFrontmatterFields([]map[string]any{
		{"note": nil}, {"note": nil}, {"note": "hello"},
	})
	f := fieldByKey(t, got, "note")
	if f.Type != typedfield.TypeText {
		t.Errorf("Type = %q, want text (only one real value observed)", f.Type)
	}
}

func TestInferFrontmatterFields_KeyOrderIsAlphabetical(t *testing.T) {
	got := InferFrontmatterFields([]map[string]any{
		{"zebra": "z", "apple": "a", "mango": "m"},
	})
	keys := make([]string, 0, len(got))
	for _, f := range got {
		keys = append(keys, f.Key)
	}
	want := []string{"apple", "mango", "zebra"}
	if !reflect.DeepEqual(keys, want) {
		t.Errorf("key order = %v, want alphabetical %v", keys, want)
	}
}

func TestInferFrontmatterFields_LabelIsSentenceCaseHumanizedKey(t *testing.T) {
	got := InferFrontmatterFields([]map[string]any{{"released_on": "2026-01-01"}})
	f := fieldByKey(t, got, "released_on")
	if f.Label != "Released on" {
		t.Errorf("Label = %q, want %q", f.Label, "Released on")
	}
}

// ShowOnCard is a presentation default, not a correctness requirement
// elsewhere in the domain, but the design contract pins it precisely:
// only the FIRST options-typed field (by key order) defaults on.
func TestInferFrontmatterFields_OnlyFirstOptionsFieldDefaultsShowOnCard(t *testing.T) {
	got := InferFrontmatterFields([]map[string]any{
		{"alpha_status": "open", "zeta_status": "todo"},
		{"alpha_status": "closed", "zeta_status": "todo"},
		{"alpha_status": "open", "zeta_status": "done"},
		{"alpha_status": "open", "zeta_status": "done"},
	})
	alpha := fieldByKey(t, got, "alpha_status")
	zeta := fieldByKey(t, got, "zeta_status")
	if alpha.Type != typedfield.TypeOptions || zeta.Type != typedfield.TypeOptions {
		t.Fatalf("both fields should infer options: alpha=%+v zeta=%+v", alpha, zeta)
	}
	if !alpha.ShowOnCard {
		t.Errorf("alpha_status (first alphabetically) ShowOnCard = false, want true")
	}
	if zeta.ShowOnCard {
		t.Errorf("zeta_status (second options field) ShowOnCard = true, want false")
	}
}

func TestInferFrontmatterFields_MixedFilesUnionAllKeys(t *testing.T) {
	got := InferFrontmatterFields([]map[string]any{
		{"ticket": "MILL-1", "owner": "alice"},
		{"released": true},
	})
	if len(got) != 3 {
		t.Fatalf("InferFrontmatterFields() = %+v, want exactly 3 fields (union across files)", got)
	}
}
