package list

import (
	"testing"

	"github.com/alicoding/mill/internal/domain/typedfield"
)

func TestValidate_Accepts(t *testing.T) {
	l := List{ID: "l1", Label: "Region codes", Entries: map[string]string{"US": "United States"}}
	if err := Validate(l); err != nil {
		t.Errorf("Validate(valid list) returned error: %v", err)
	}
}

func TestValidate_EmptyEntries_Accepted(t *testing.T) {
	l := List{ID: "l1", Label: "Empty for now"}
	if err := Validate(l); err != nil {
		t.Errorf("Validate(list with no entries yet) returned error: %v, want nil -- an empty list is a valid starting state", err)
	}
}

func TestValidate_EmptyLabel_Rejected(t *testing.T) {
	l := List{ID: "l1", Label: "  "}
	if err := Validate(l); err == nil {
		t.Error("Validate with an empty label returned nil error, want an error")
	}
}

func TestValidate_TypedColumns_Accepted(t *testing.T) {
	l := List{
		ID: "l1", Label: "Typed list",
		Columns: []typedfield.Field{
			{Key: "code", Label: "Code", Type: typedfield.TypeText},
			{Key: "name", Label: "Name", Type: typedfield.TypeText},
		},
		Rows: []Row{
			{ID: "r1", Values: map[string]string{"code": "US", "name": "United States"}, Status: RowActive},
		},
	}
	if err := Validate(l); err != nil {
		t.Errorf("Validate(typed list) returned error: %v", err)
	}
}

func TestValidate_DuplicateColumnKey_Rejected(t *testing.T) {
	l := List{
		ID: "l1", Label: "Typed list",
		Columns: []typedfield.Field{
			{Key: "code", Label: "Code", Type: typedfield.TypeText},
			{Key: "code", Label: "Code again", Type: typedfield.TypeText},
		},
	}
	if err := Validate(l); err == nil {
		t.Error("Validate with a duplicate column key returned nil error, want an error")
	}
}

func TestValidate_InvalidColumnType_Rejected(t *testing.T) {
	l := List{
		ID: "l1", Label: "Typed list",
		Columns: []typedfield.Field{{Key: "code", Label: "Code", Type: "not-a-real-type"}},
	}
	if err := Validate(l); err == nil {
		t.Error("Validate with an invalid column type returned nil error, want an error")
	}
}

func TestValidate_RowWithEmptyID_Rejected(t *testing.T) {
	l := List{
		ID: "l1", Label: "Typed list",
		Rows: []Row{{ID: "  ", Values: map[string]string{}}},
	}
	if err := Validate(l); err == nil {
		t.Error("Validate with a blank row id returned nil error, want an error")
	}
}

func TestDeriveEntries_TwoColumns_ExcludesExpired(t *testing.T) {
	l := List{
		Columns: []typedfield.Field{
			{Key: "code", Label: "Code", Type: typedfield.TypeText},
			{Key: "name", Label: "Name", Type: typedfield.TypeText},
		},
		Rows: []Row{
			{ID: "r1", Values: map[string]string{"code": "US", "name": "United States"}, Status: RowActive},
			{ID: "r2", Values: map[string]string{"code": "SU", "name": "Soviet Union"}, Status: RowExpired},
		},
	}
	got := DeriveEntries(l)
	if len(got) != 1 || got["US"] != "United States" {
		t.Errorf("DeriveEntries = %+v, want only the Active row's US -> United States", got)
	}
	if _, ok := got["SU"]; ok {
		t.Error("DeriveEntries included an Expired row's entry, want it excluded by default")
	}
}

func TestDeriveEntries_FewerThanTwoColumns_ReturnsNil(t *testing.T) {
	l := List{Columns: []typedfield.Field{{Key: "code", Label: "Code", Type: typedfield.TypeText}}}
	if got := DeriveEntries(l); got != nil {
		t.Errorf("DeriveEntries(1 column) = %+v, want nil", got)
	}
}

func TestMigrateLegacyEntries_DeterministicSortedByKey(t *testing.T) {
	entries := map[string]string{"US": "United States", "CA": "Canada", "MX": "Mexico"}
	i := 0
	ids := []string{"row-a", "row-b", "row-c"}
	newID := func() string { id := ids[i]; i++; return id }

	columns, rows := MigrateLegacyEntries(entries, newID)
	if len(columns) != 2 || columns[0].Key != "key" || columns[1].Key != "value" {
		t.Fatalf("MigrateLegacyEntries columns = %+v, want [key, value]", columns)
	}
	if len(rows) != 3 {
		t.Fatalf("MigrateLegacyEntries rows = %d, want 3", len(rows))
	}
	// Sorted by key: CA, MX, US.
	wantKeys := []string{"CA", "MX", "US"}
	for i, r := range rows {
		if r.Values["key"] != wantKeys[i] {
			t.Errorf("row %d key = %q, want %q (deterministic sorted order)", i, r.Values["key"], wantKeys[i])
		}
		if r.Status != RowActive {
			t.Errorf("row %d status = %q, want Active", i, r.Status)
		}
		if r.ID != ids[i] {
			t.Errorf("row %d id = %q, want %q (from the injected newRowID)", i, r.ID, ids[i])
		}
		if r.CreatedAt.IsZero() || r.UpdatedAt.IsZero() {
			t.Errorf("row %d CreatedAt/UpdatedAt is zero, want stamped at migration time", i)
		}
	}
}

func TestMigrateLegacyEntries_Empty_ReturnsNil(t *testing.T) {
	columns, rows := MigrateLegacyEntries(nil, func() string { return "x" })
	if columns != nil || rows != nil {
		t.Errorf("MigrateLegacyEntries(nil) = %+v, %+v, want nil, nil", columns, rows)
	}
}
