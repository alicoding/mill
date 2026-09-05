package decision

import (
	"encoding/json"
	"testing"
)

// TestDecisionUnmarshal_MigratesLegacyEnumValues proves an
// already-persisted Decision -- written before ADR-0029 Phase 2 renamed
// OutputField.EnumValues to Options -- still decodes with its enum
// values intact, migrated onto the new Options field, not silently
// dropped. Mirrors the precedent ADR-0016's configure-connectors ->
// configure-requests key migration test already set (verify the
// migration by loading a real old-shape document, not by assuming
// json.Unmarshal "just works").
func TestDecisionUnmarshal_MigratesLegacyEnumValues(t *testing.T) {
	// The exact shape json.Marshal of the pre-Phase-2 OutputField
	// (Key/Label/Type/EnumValues) would have produced for a real
	// approve/deny Decision.
	oldShape := `{
		"ID": "example-approve-decision",
		"Label": "Approve",
		"Category": "approve",
		"Outputs": [
			{"Key": "decision", "Label": "Decision", "Type": "text", "EnumValues": ["APPROVED", "DECLINED"]},
			{"Key": "score", "Label": "Score", "Type": "number", "EnumValues": null}
		],
		"WebhookRequestID": "",
		"BuiltIn": true
	}`

	var d Decision
	if err := json.Unmarshal([]byte(oldShape), &d); err != nil {
		t.Fatalf("pre-Phase-2 Decision JSON failed to unmarshal: %v", err)
	}

	if d.ID != "example-approve-decision" || d.Category != CategoryApprove {
		t.Fatalf("Decision decoded wrong: %+v", d)
	}
	if len(d.Outputs) != 2 {
		t.Fatalf("got %d outputs, want 2", len(d.Outputs))
	}

	got := d.Outputs[0].Options
	want := []string{"APPROVED", "DECLINED"}
	if len(got) != len(want) || got[0] != want[0] || got[1] != want[1] {
		t.Errorf("legacy EnumValues did not migrate to Options: got %v, want %v", got, want)
	}
	if d.Outputs[0].Key != "decision" || d.Outputs[0].Type != "text" {
		t.Errorf("output field 0 decoded wrong: %+v", d.Outputs[0])
	}

	// A field that had no EnumValues at all (null) must stay an empty
	// Options, not error or fabricate a value.
	if len(d.Outputs[1].Options) != 0 {
		t.Errorf("output field 1 (no legacy EnumValues) got a non-empty Options: %v", d.Outputs[1].Options)
	}

	if err := Validate(d); err != nil {
		t.Errorf("migrated Decision failed Validate: %v", err)
	}
}

// TestDecisionUnmarshal_NewShapeUnaffected proves the migration is a
// true no-op on a document already written in the new (post-Phase-2)
// shape -- Options present, no legacy EnumValues key at all -- so
// re-saving an already-migrated Decision never touches its data.
func TestDecisionUnmarshal_NewShapeUnaffected(t *testing.T) {
	newShape := `{
		"ID": "example-deny-decision",
		"Label": "Deny",
		"Category": "deny",
		"Outputs": [
			{"Key": "decision", "Label": "Decision", "Type": "text", "Options": ["APPROVED", "DECLINED"]}
		],
		"WebhookRequestID": "",
		"BuiltIn": true
	}`

	var d Decision
	if err := json.Unmarshal([]byte(newShape), &d); err != nil {
		t.Fatalf("new-shape Decision JSON failed to unmarshal: %v", err)
	}
	got := d.Outputs[0].Options
	want := []string{"APPROVED", "DECLINED"}
	if len(got) != len(want) || got[0] != want[0] || got[1] != want[1] {
		t.Errorf("new-shape Options mishandled: got %v, want %v", got, want)
	}
}

// TestDecisionUnmarshal_BothPresentPrefersOptions proves that if a
// document somehow carries both keys (a transitional/hand-edited case),
// a real Options value is never overwritten by a stale EnumValues one
// -- the migration only fires when Options is empty.
func TestDecisionUnmarshal_BothPresentPrefersOptions(t *testing.T) {
	both := `{
		"ID": "x", "Label": "x", "Category": "approve",
		"Outputs": [
			{"Key": "k", "Label": "K", "Type": "text", "Options": ["NEW"], "EnumValues": ["OLD"]}
		]
	}`
	var d Decision
	if err := json.Unmarshal([]byte(both), &d); err != nil {
		t.Fatalf("unmarshal failed: %v", err)
	}
	got := d.Outputs[0].Options
	if len(got) != 1 || got[0] != "NEW" {
		t.Errorf("Options should win when both keys present, got %v", got)
	}
}
