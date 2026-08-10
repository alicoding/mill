package composition

import (
	"encoding/json"
	"reflect"
	"testing"
)

// ADR-0029 Phase 1's whole promise is zero-migration: AttributeDef and
// ConfigField became type aliases of typedfield.Field, which only adds
// fields (Required/Secret/SystemManaged/...) -- it must never break
// decoding data that was already on a real user's disk before this
// change landed (compositionsvc persists a workflow's whole []Node/
// []AttributeDef graph as one JSON blob, settings.go).

// TestAttributeDefUnmarshal_PreExistingShape proves an already-persisted
// AttributeDef document -- the exact {Key,Label,Type} shape every
// AttributeDef in this repo was written in before Phase 1 (see
// builtinworkflows.go's own seeded {Key: "message", Label: "Message",
// Type: FieldText} literals) -- still unmarshals correctly into the
// now-widened struct, with every field Phase 1 added filling its Go
// zero value rather than erroring or silently misplacing data.
func TestAttributeDefUnmarshal_PreExistingShape(t *testing.T) {
	// A real pre-Phase-1 workflow's Attributes array, byte for byte what
	// json.Marshal of the old three-field struct produced.
	oldShape := `[
		{"Key": "message", "Label": "Message", "Type": "text"},
		{"Key": "amount", "Label": "Amount", "Type": "number"}
	]`

	var attrs []AttributeDef
	if err := json.Unmarshal([]byte(oldShape), &attrs); err != nil {
		t.Fatalf("pre-Phase-1 AttributeDef JSON failed to unmarshal into the widened struct: %v", err)
	}
	if len(attrs) != 2 {
		t.Fatalf("got %d attributes, want 2", len(attrs))
	}

	msg := attrs[0]
	if msg.Key != "message" || msg.Label != "Message" || msg.Type != FieldText {
		t.Errorf("message attribute decoded wrong: %+v", msg)
	}
	// Everything Phase 1 added must be the Go zero value -- absent from
	// the old JSON, never guessed at or defaulted to something else.
	if msg.Required != false || msg.Default != "" || msg.Description != "" ||
		msg.Options != nil || msg.Suggestions != nil || msg.Secret != false ||
		msg.RefKind != "" || msg.Multiline != false || msg.SystemManaged != false {
		t.Errorf("pre-existing AttributeDef picked up non-zero values for fields it never declared: %+v", msg)
	}

	amount := attrs[1]
	if amount.Key != "amount" || amount.Type != FieldNumber {
		t.Errorf("amount attribute decoded wrong: %+v", amount)
	}

	// Round-trip: re-marshaling and re-decoding must be stable (proves
	// the alias isn't just accepting the old shape by accident but
	// actually representing it correctly end to end).
	reMarshaled, err := json.Marshal(attrs)
	if err != nil {
		t.Fatalf("re-marshal failed: %v", err)
	}
	var attrs2 []AttributeDef
	if err := json.Unmarshal(reMarshaled, &attrs2); err != nil {
		t.Fatalf("round-trip unmarshal failed: %v", err)
	}
	if !reflect.DeepEqual(attrs2, attrs) {
		t.Errorf("round-trip mismatch: got %+v, want %+v", attrs2, attrs)
	}
}

// TestConfigFieldUnmarshal_PreExistingShape mirrors the AttributeDef
// case above for ConfigField, whose pre-Phase-1 shape already carried
// more fields (Key/Label/Description/Default/Type/Options/RefKind/
// Multiline/Suggestions) -- confirms the newly-added Required/Secret/
// SystemManaged fields don't disturb decoding a document that predates
// them.
func TestConfigFieldUnmarshal_PreExistingShape(t *testing.T) {
	oldShape := `{
		"Key": "html", "Label": "HTML", "Description": "the HTML to write",
		"Default": "<p>sample</p>", "Type": "text", "Options": null,
		"RefKind": "", "Multiline": true, "Suggestions": null
	}`

	var field ConfigField
	if err := json.Unmarshal([]byte(oldShape), &field); err != nil {
		t.Fatalf("pre-Phase-1 ConfigField JSON failed to unmarshal into the widened struct: %v", err)
	}
	if field.Key != "html" || field.Label != "HTML" || field.Type != FieldText || !field.Multiline {
		t.Errorf("ConfigField decoded wrong: %+v", field)
	}
	if field.Required != false || field.Secret != false || field.SystemManaged != false {
		t.Errorf("pre-existing ConfigField picked up non-zero values for fields it never declared: %+v", field)
	}
}
