package composition

import (
	"testing"

	"github.com/alicoding/mill/internal/adapters/aiclient"
	"github.com/alicoding/mill/internal/domain/typedfield"
)

func TestParseAIExtractFields_EmptyIsNilNoError(t *testing.T) {
	fields, err := parseAIExtractFields("")
	if err != nil || fields != nil {
		t.Errorf("parseAIExtractFields(\"\") = %v, %v; want nil, nil", fields, err)
	}
}

func TestParseAIExtractFields_InvalidJSON(t *testing.T) {
	if _, err := parseAIExtractFields("not json"); err == nil {
		t.Fatal("expected an error for invalid outputFields JSON")
	}
}

func TestBuildExtractSchema_EveryFieldRequiredWithMappedType(t *testing.T) {
	fields := []aiExtractOutputField{
		{Key: "amount", Type: typedfield.TypeNumber},
		{Key: "urgent", Type: typedfield.TypeBoolean},
		{Key: "note", Type: typedfield.TypeText},
		{Key: "priority", Type: typedfield.TypeOptions, Options: []string{"low", "high"}},
	}
	schema, err := buildExtractSchema(fields)
	if err != nil {
		t.Fatalf("buildExtractSchema: %v", err)
	}
	s := string(schema)
	for _, want := range []string{`"amount"`, `"number"`, `"urgent"`, `"boolean"`, `"note"`, `"string"`, `"priority"`, `"enum"`, `"low"`, `"high"`} {
		if !jsonContains(s, want) {
			t.Errorf("schema %s missing expected fragment %s", s, want)
		}
	}
}

func jsonContains(s, substr string) bool {
	for i := 0; i+len(substr) <= len(s); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}

func TestAIExtractStructuredExec_WritesTypedAttributes(t *testing.T) {
	withAIStubs(t, ResolvedAIProvider{Kind: "openai-compatible", BaseURL: "http://localhost:11434", Model: "llama3.2"},
		func(req aiclient.Request) (aiclient.Result, error) {
			if req.Schema == nil {
				t.Error("expected a Schema on the request")
			}
			return aiclient.Result{JSON: []byte(`{"amount":42.5,"urgent":true,"note":"call back"}`)}, nil
		})

	exec := lookupNodeType(t, "process-ai-extract-structured")
	node := Node{ID: "n1", NodeTypeID: "process-ai-extract-structured", Config: map[string]string{
		aiProviderIDConfigKey: "p1",
		"prompt":              "extract the invoice",
		"outputFields":        `[{"Key":"amount","Type":"number"},{"Key":"urgent","Type":"boolean"},{"Key":"note","Type":"text"}]`,
	}}
	out, err := exec(node, ExecContext{Payload: "Invoice #123: $42.50, urgent, please call back"})
	if err != nil {
		t.Fatalf("exec: %v", err)
	}
	if out.Attributes["amount"] != 42.5 {
		t.Errorf("Attributes[amount] = %v, want 42.5", out.Attributes["amount"])
	}
	if out.Attributes["urgent"] != true {
		t.Errorf("Attributes[urgent] = %v, want true", out.Attributes["urgent"])
	}
	if out.Attributes["note"] != "call back" {
		t.Errorf("Attributes[note] = %v, want %q", out.Attributes["note"], "call back")
	}
	// The payload itself is left unchanged (this node's own Output
	// contract: "unchanged payload").
	if out.Payload != "Invoice #123: $42.50, urgent, please call back" {
		t.Errorf("Payload was mutated, want it unchanged: %q", out.Payload)
	}
}

func TestAIExtractStructuredExec_MissingFieldGetsZeroValue(t *testing.T) {
	withAIStubs(t, ResolvedAIProvider{Model: "m"}, func(aiclient.Request) (aiclient.Result, error) {
		return aiclient.Result{JSON: []byte(`{"amount":10}`)}, nil // "note" omitted
	})
	exec := lookupNodeType(t, "process-ai-extract-structured")
	node := Node{ID: "n1", NodeTypeID: "process-ai-extract-structured", Config: map[string]string{
		aiProviderIDConfigKey: "p1",
		"outputFields":        `[{"Key":"amount","Type":"number"},{"Key":"note","Type":"text"}]`,
	}}
	out, err := exec(node, ExecContext{})
	if err != nil {
		t.Fatalf("exec: %v", err)
	}
	if out.Attributes["note"] != "" {
		t.Errorf("Attributes[note] = %v, want the zero value for text (\"\")", out.Attributes["note"])
	}
}

func TestAIExtractStructuredExec_NoOutputFieldsConfigured_Errors(t *testing.T) {
	withAIStubs(t, ResolvedAIProvider{Model: "m"}, func(aiclient.Request) (aiclient.Result, error) {
		t.Fatal("aiCompleteFn should not be called with no output fields configured")
		return aiclient.Result{}, nil
	})
	exec := lookupNodeType(t, "process-ai-extract-structured")
	node := Node{ID: "n1", NodeTypeID: "process-ai-extract-structured", Config: map[string]string{aiProviderIDConfigKey: "p1"}}
	if _, err := exec(node, ExecContext{}); err == nil {
		t.Fatal("expected an error for no configured output fields")
	}
}
