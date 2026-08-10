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
		Key:           "amount",
		Label:         "Amount",
		Type:          TypeOptions,
		Required:      true,
		Default:       "10",
		Description:   "an amount",
		Options:       []string{"10", "20"},
		Suggestions:   []string{"10"},
		Secret:        true,
		RefKind:       "list",
		Multiline:     true,
		SystemManaged: true,
	}
	if err := Validate(f); err != nil {
		t.Fatalf("Validate rejected a fully-populated, valid field: %v", err)
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
