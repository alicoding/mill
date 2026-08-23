package typedfield

import "testing"

func TestValidate_RejectsEmptyKey(t *testing.T) {
	err := Validate(Field{Key: "", Type: TypeText})
	if err == nil {
		t.Fatal("expected an error for an empty key, got nil")
	}
}

func TestValidate_RejectsBlankKey(t *testing.T) {
	err := Validate(Field{Key: "   ", Type: TypeText})
	if err == nil {
		t.Fatal("expected an error for a whitespace-only key, got nil")
	}
}

func TestValidate_RejectsUnknownType(t *testing.T) {
	err := Validate(Field{Key: "k", Type: Type("nonsense")})
	if err == nil {
		t.Fatal("expected an error for an invalid type, got nil")
	}
}

func TestValidate_AcceptsEveryDeclaredType(t *testing.T) {
	for _, typ := range []Type{
		TypeText, TypeNumber, TypeBoolean, TypeOptions,
		TypeInteger, TypeObject, TypeArray, TypeMap, TypeDate, TypeDatetime,
	} {
		if err := Validate(Field{Key: "k", Type: typ}); err != nil {
			t.Errorf("Validate rejected declared type %q: %v", typ, err)
		}
	}
}

func TestValidate_AcceptsFullyPopulatedField(t *testing.T) {
	f := Field{
		Key:              "amount",
		Label:            "Amount",
		Type:             TypeOptions,
		Required:         true,
		Default:          "10",
		Description:      "an amount",
		Options:          []string{"10", "20"},
		Suggestions:      []string{"10"},
		Secret:           true,
		RefKind:          "list",
		Multiline:        true,
		SystemManaged:    true,
		RollupDoneValues: []string{"20"},
	}
	if err := Validate(f); err != nil {
		t.Fatalf("Validate rejected a fully-populated, valid field: %v", err)
	}
}

// A field declaring no RollupDoneValues is the ordinary, pre-existing
// case (goal 0164 L3's additivity requirement): every field shape that
// validated before this facet existed must keep validating unchanged.
func TestValidate_AcceptsFieldWithNoRollupDoneValues(t *testing.T) {
	f := Field{Key: "status", Type: TypeOptions, Options: []string{"Open", "Done"}}
	if err := Validate(f); err != nil {
		t.Fatalf("Validate rejected a field with no RollupDoneValues: %v", err)
	}
}

func TestValidate_RejectsRollupDoneValuesOnNonOptionsField(t *testing.T) {
	f := Field{Key: "note", Type: TypeText, RollupDoneValues: []string{"done"}}
	if err := Validate(f); err == nil {
		t.Fatal("expected an error for RollupDoneValues on a non-TypeOptions field, got nil")
	}
}

func TestValidate_RejectsRollupDoneValueNotInOptions(t *testing.T) {
	f := Field{Key: "status", Type: TypeOptions, Options: []string{"Open", "Closed"}, RollupDoneValues: []string{"Done"}}
	if err := Validate(f); err == nil {
		t.Fatal("expected an error for a RollupDoneValues entry absent from Options, got nil")
	}
}

// TypeText/TypeNumber/TypeBoolean/TypeOptions must stay wire-identical
// to composition.ConfigFieldType's own long-persisted values -- ADR-0029
// is explicit this is a zero-migration change; a value drift here would
// silently break every already-persisted Node.Config/AttributeDef on
// disk.
func TestWireIdentical_CoreFourValues(t *testing.T) {
	cases := map[Type]string{
		TypeText:    "text",
		TypeNumber:  "number",
		TypeBoolean: "boolean",
		TypeOptions: "options",
	}
	for typ, want := range cases {
		if string(typ) != want {
			t.Errorf("Type %v: wire value %q, want %q (wire-compat break)", typ, string(typ), want)
		}
	}
}

// --- ValidateFieldEvolution (docs/adr/0040 decisions 1-3) ---

func TestValidateFieldEvolution_AllowsAddingANewKey(t *testing.T) {
	old := []Field{{Key: "a", Type: TypeText}}
	next := []Field{{Key: "a", Type: TypeText}, {Key: "b", Type: TypeNumber}}
	if err := ValidateFieldEvolution(old, next, nil); err != nil {
		t.Fatalf("adding a new key should be free: %v", err)
	}
}

func TestValidateFieldEvolution_AllowsLabelOnlyChange(t *testing.T) {
	old := []Field{{Key: "a", Type: TypeText, Label: "Old"}}
	next := []Field{{Key: "a", Type: TypeText, Label: "New"}}
	if err := ValidateFieldEvolution(old, next, nil); err != nil {
		t.Fatalf("renaming a Label should be free: %v", err)
	}
}

func TestValidateFieldEvolution_RejectsSilentDrop(t *testing.T) {
	old := []Field{{Key: "a", Type: TypeText}}
	err := ValidateFieldEvolution(old, nil, nil)
	if err == nil {
		t.Fatal("expected an error when a key disappears without a matching tombstone")
	}
}

func TestValidateFieldEvolution_RejectsRekey(t *testing.T) {
	// A rename is structurally "drop the old key, add a new one" -- the
	// drop half must still be rejected even though a brand-new key
	// legitimately appears in the same update.
	old := []Field{{Key: "a", Type: TypeText}}
	next := []Field{{Key: "b", Type: TypeText}}
	if err := ValidateFieldEvolution(old, next, nil); err == nil {
		t.Fatal("expected an error for a re-key (old key dropped, new key added, no tombstone)")
	}
}

func TestValidateFieldEvolution_RejectsInPlaceRetype(t *testing.T) {
	old := []Field{{Key: "a", Type: TypeText}}
	next := []Field{{Key: "a", Type: TypeNumber}}
	if err := ValidateFieldEvolution(old, next, nil); err == nil {
		t.Fatal("expected an error for retyping an existing key in place")
	}
}

func TestValidateFieldEvolution_AllowsTombstonedDelete(t *testing.T) {
	old := []Field{{Key: "a", Type: TypeText}}
	tombstones := []FieldTombstone{{Key: "a", Type: TypeText}}
	if err := ValidateFieldEvolution(old, nil, tombstones); err != nil {
		t.Fatalf("a delete declared via a matching tombstone should be legal: %v", err)
	}
}

func TestValidateFieldEvolution_RejectsTombstoneTypeMismatchAgainstOld(t *testing.T) {
	old := []Field{{Key: "a", Type: TypeText}}
	tombstones := []FieldTombstone{{Key: "a", Type: TypeNumber}}
	if err := ValidateFieldEvolution(old, nil, tombstones); err == nil {
		t.Fatal("expected an error when the tombstone's type disagrees with the field actually being deleted")
	}
}

func TestValidateFieldEvolution_AllowsResurrectSameType(t *testing.T) {
	tombstones := []FieldTombstone{{Key: "a", Type: TypeText}}
	next := []Field{{Key: "a", Type: TypeText}}
	if err := ValidateFieldEvolution(nil, next, tombstones); err != nil {
		t.Fatalf("resurrecting a tombstoned key at its original type should be legal: %v", err)
	}
}

func TestValidateFieldEvolution_RejectsResurrectDifferentType(t *testing.T) {
	tombstones := []FieldTombstone{{Key: "a", Type: TypeText}}
	next := []Field{{Key: "a", Type: TypeNumber}}
	if err := ValidateFieldEvolution(nil, next, tombstones); err == nil {
		t.Fatal("expected an error resurrecting a tombstoned key under a different type")
	}
}

// --- MergeTombstones ---

func TestMergeTombstones_UnionsAndDedupesByKey(t *testing.T) {
	existing := []FieldTombstone{{Key: "a", Type: TypeText}}
	additions := []FieldTombstone{{Key: "b", Type: TypeNumber}}
	got := MergeTombstones(existing, additions)
	if len(got) != 2 {
		t.Fatalf("expected 2 merged tombstones, got %d: %+v", len(got), got)
	}
}

func TestMergeTombstones_ExistingWinsOnKeyCollision(t *testing.T) {
	existing := []FieldTombstone{{Key: "a", Type: TypeText}}
	additions := []FieldTombstone{{Key: "a", Type: TypeNumber}}
	got := MergeTombstones(existing, additions)
	if len(got) != 1 || got[0].Type != TypeText {
		t.Fatalf("expected the existing tombstone's type to win, got %+v", got)
	}
}

func TestMergeTombstones_DeterministicOrder(t *testing.T) {
	existing := []FieldTombstone{{Key: "a", Type: TypeText}, {Key: "b", Type: TypeNumber}}
	additions := []FieldTombstone{{Key: "c", Type: TypeBoolean}}
	first := MergeTombstones(existing, additions)
	second := MergeTombstones(existing, additions)
	if len(first) != len(second) {
		t.Fatalf("length mismatch across identical calls: %d vs %d", len(first), len(second))
	}
	for i := range first {
		if first[i] != second[i] {
			t.Fatalf("MergeTombstones is not deterministic at index %d: %+v vs %+v", i, first[i], second[i])
		}
	}
}

func TestValidateRequired_ReturnsCallerMessageForBlankRequiredField(t *testing.T) {
	fields := []Field{{Key: "label", Required: true}}
	err := ValidateRequired(fields, map[string]string{"label": "  "}, map[string]string{"label": "needs a label"})
	if err == nil || err.Error() != "needs a label" {
		t.Fatalf("expected the caller-supplied message verbatim, got %v", err)
	}
}

func TestValidateRequired_AcceptsNonBlankValue(t *testing.T) {
	fields := []Field{{Key: "label", Required: true}}
	err := ValidateRequired(fields, map[string]string{"label": "x"}, map[string]string{"label": "needs a label"})
	if err != nil {
		t.Fatalf("expected no error for a populated required field, got %v", err)
	}
}

func TestValidateRequired_SkipsFieldsAbsentFromMessages(t *testing.T) {
	// A Required field with no messages entry is the caller's own
	// follow-up-check case (a conditional requirement, a custom
	// message) -- ValidateRequired must not misfire a generic error.
	fields := []Field{{Key: "kind", Required: true}}
	err := ValidateRequired(fields, map[string]string{"kind": ""}, map[string]string{})
	if err != nil {
		t.Fatalf("expected ValidateRequired to skip a field absent from messages, got %v", err)
	}
}

func TestValidateRequired_SkipsNonRequiredFieldEvenWithMessage(t *testing.T) {
	fields := []Field{{Key: "baseURL", Required: false}}
	err := ValidateRequired(fields, map[string]string{"baseURL": ""}, map[string]string{"baseURL": "needs a base URL"})
	if err != nil {
		t.Fatalf("expected ValidateRequired to skip a non-Required field, got %v", err)
	}
}

func TestValidateRequired_ChecksFieldsInDeclaredOrder(t *testing.T) {
	fields := []Field{{Key: "first", Required: true}, {Key: "second", Required: true}}
	values := map[string]string{"first": "", "second": ""}
	messages := map[string]string{"first": "first missing", "second": "second missing"}
	err := ValidateRequired(fields, values, messages)
	if err == nil || err.Error() != "first missing" {
		t.Fatalf("expected the first blank field's message to win, got %v", err)
	}
}
