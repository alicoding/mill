package configuresvc

import (
	"strings"
	"testing"

	"github.com/alicoding/mill/internal/domain/typedfield"
)

func trackerColumns() []typedfield.Field {
	return []typedfield.Field{
		{Key: "task", Label: "Task", Type: typedfield.TypeText, Required: true},
		{Key: "count", Label: "Count", Type: typedfield.TypeNumber},
	}
}

// TestApplyListRow_CreatesThenUpdatesByKeyColumn is docs/goals/0070's
// core write-path proof: a first call with no existing row matching
// the key column appends a new row; a second call with the SAME key
// value merges into that same row instead of appending a duplicate --
// unbound columns (count, untouched by the second call) keep their
// prior value, the same "only the named fields change" merge
// apply-atlas-card-update's own AtlasCard documents.
func TestApplyListRow_CreatesThenUpdatesByKeyColumn(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	l, err := cfg.CreateList("Tracker", "", trackerColumns())
	if err != nil {
		t.Fatalf("CreateList: %v", err)
	}

	created, err := cfg.ApplyListRow(l.ID, "task", map[string]string{"task": "Ship it", "count": "1"})
	if err != nil {
		t.Fatalf("ApplyListRow (create): %v", err)
	}
	if created.Values["task"] != "Ship it" || created.Values["count"] != "1" {
		t.Fatalf("created row = %+v, want task=Ship it count=1", created.Values)
	}

	updated, err := cfg.ApplyListRow(l.ID, "task", map[string]string{"task": "Ship it", "status": "unused"})
	if err != nil {
		t.Fatalf("ApplyListRow (update): %v", err)
	}
	if updated.ID != created.ID {
		t.Fatalf("update created a NEW row (id %q != %q), want the same row updated in place", updated.ID, created.ID)
	}
	if updated.Values["count"] != "1" {
		t.Errorf("update dropped the unbound 'count' field: %+v, want it preserved at 1", updated.Values)
	}

	var found int
	for _, row := range cfg.Lists()[0].Rows {
		if row.Values["task"] == "Ship it" {
			found++
		}
	}
	if found != 1 {
		t.Fatalf("Rows contains %d rows for task=%q, want exactly 1 (create-then-update must never duplicate)", found, "Ship it")
	}
}

// TestApplyListRow_TypedValidation_RejectsInvalidValue is the "honest
// path, never silent coercion" acceptance: a non-numeric value bound to
// a TypeNumber column is a step error, not a value silently written
// as-is or coerced to zero.
func TestApplyListRow_TypedValidation_RejectsInvalidValue(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	l, err := cfg.CreateList("Tracker", "", trackerColumns())
	if err != nil {
		t.Fatalf("CreateList: %v", err)
	}

	if _, err := cfg.ApplyListRow(l.ID, "task", map[string]string{"task": "Ship it", "count": "not-a-number"}); err == nil {
		t.Fatal("ApplyListRow with a non-numeric 'count' value returned nil error, want a typed-validation rejection")
	} else if !strings.Contains(err.Error(), "count") {
		t.Errorf("error = %v, want it to name the offending field %q", err, "count")
	}

	if len(cfg.Lists()[0].Rows) != 0 {
		t.Fatal("a rejected typed value must never be persisted (no silent coercion)")
	}
}

func TestApplyListRow_MissingKeyColumnValue_Rejected(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	l, err := cfg.CreateList("Tracker", "", trackerColumns())
	if err != nil {
		t.Fatalf("CreateList: %v", err)
	}
	if _, err := cfg.ApplyListRow(l.ID, "task", map[string]string{"count": "1"}); err == nil {
		t.Fatal("ApplyListRow with no value bound for the key column returned nil error, want a rejection")
	}
}

func TestApplyListRow_UnknownList_Rejected(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	if _, err := cfg.ApplyListRow("does-not-exist", "task", map[string]string{"task": "x"}); err == nil {
		t.Fatal("ApplyListRow against an unknown list returned nil error, want a rejection")
	}
}
