package aiclient

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// TestDefaultAnthropicBaseURL_WireIdenticalToDomainConstant guards the
// intentional duplication this file's own doc comment names -- a drift
// here would silently point the adapter at a different host than
// aiprovider.DefaultAnthropicBaseURL promises callers/UI copy.
func TestDefaultAnthropicBaseURL_WireIdenticalToDomainConstant(t *testing.T) {
	if defaultAnthropicBaseURL != "https://api.anthropic.com" {
		t.Errorf("defaultAnthropicBaseURL = %q, want the real Anthropic host (mirrors aiprovider.DefaultAnthropicBaseURL)", defaultAnthropicBaseURL)
	}
}

func TestCompleteAnthropic_PlainText(t *testing.T) {
	var gotHeaders http.Header
	var gotBody map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/messages" {
			t.Errorf("unexpected path %q", r.URL.Path)
		}
		gotHeaders = r.Header
		_ = json.NewDecoder(r.Body).Decode(&gotBody)
		_, _ = w.Write([]byte(`{"content":[{"type":"text","text":"hello from claude"}]}`))
	}))
	t.Cleanup(srv.Close)

	result, err := Complete(Request{ //nolint:gosec // a fixture test credential below, not a real secret
		Kind: KindAnthropic, BaseURL: srv.URL, Model: "claude-sonnet-4-5", APIKey: "sk-ant-test",
		System: "be terse", Prompt: "say hi",
	})
	if err != nil {
		t.Fatalf("Complete: %v", err)
	}
	if result.Text != "hello from claude" {
		t.Errorf("Text = %q, want the fixture's reply", result.Text)
	}
	if got := gotHeaders.Get("x-api-key"); got != "sk-ant-test" {
		t.Errorf("x-api-key header = %q, want %q", got, "sk-ant-test")
	}
	if got := gotHeaders.Get("anthropic-version"); got != anthropicVersion {
		t.Errorf("anthropic-version header = %q, want %q", got, anthropicVersion)
	}
	if gotBody["system"] != "be terse" {
		t.Errorf("system = %v, want %q", gotBody["system"], "be terse")
	}
}

// TestEffectiveAnthropicBaseURL_BlankDefaultsToRealHost is a pure unit
// test (no network) proving the fallback completeAnthropic relies on --
// docs/goals/0031-ai-node-family.md item 4's "CI never needs a model"
// bar applies to network reachability too, not just model output.
func TestEffectiveAnthropicBaseURL_BlankDefaultsToRealHost(t *testing.T) {
	if got := effectiveAnthropicBaseURL(""); got != defaultAnthropicBaseURL {
		t.Errorf("effectiveAnthropicBaseURL(\"\") = %q, want %q", got, defaultAnthropicBaseURL)
	}
}

func TestEffectiveAnthropicBaseURL_NonBlankPassesThrough(t *testing.T) {
	if got := effectiveAnthropicBaseURL("http://localhost:1234"); got != "http://localhost:1234" {
		t.Errorf("effectiveAnthropicBaseURL(custom) = %q, want it unchanged", got)
	}
}

func contains(s, substr string) bool {
	for i := 0; i+len(substr) <= len(s); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}

func TestCompleteAnthropic_StructuredOutputViaForcedToolUse(t *testing.T) {
	var gotBody map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewDecoder(r.Body).Decode(&gotBody)
		_, _ = w.Write([]byte(`{"content":[{"type":"tool_use","id":"t1","name":"classification","input":{"category":"invoice"}}]}`))
	}))
	t.Cleanup(srv.Close)

	result, err := Complete(Request{
		Kind: KindAnthropic, BaseURL: srv.URL, Model: "claude-sonnet-4-5", Prompt: "classify",
		Schema: &SchemaSpec{Name: "classification", Schema: []byte(`{"type":"object","properties":{"category":{"type":"string"}}}`)},
	})
	if err != nil {
		t.Fatalf("Complete: %v", err)
	}
	if string(result.JSON) != `{"category":"invoice"}` {
		t.Errorf("JSON = %s, want the tool_use block's input", result.JSON)
	}
	toolChoice, _ := gotBody["tool_choice"].(map[string]any)
	if toolChoice["name"] != "classification" {
		t.Errorf("tool_choice.name = %v, want %q (forced tool use)", toolChoice["name"], "classification")
	}
}

func TestCompleteAnthropic_StructuredOutputNoToolUseBlockErrors(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"content":[{"type":"text","text":"I refuse"}]}`))
	}))
	t.Cleanup(srv.Close)
	_, err := Complete(Request{
		Kind: KindAnthropic, BaseURL: srv.URL, Model: "claude-sonnet-4-5", Prompt: "x",
		Schema: &SchemaSpec{Name: "s", Schema: []byte(`{"type":"object"}`)},
	})
	if err == nil {
		t.Fatal("expected an error when structured output was requested but no tool_use block came back")
	}
}

func TestCompleteAnthropic_NonSuccessStatus(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusForbidden)
		_, _ = w.Write([]byte(`{"error":"bad key"}`))
	}))
	t.Cleanup(srv.Close)
	_, err := Complete(Request{Kind: KindAnthropic, BaseURL: srv.URL, Model: "m", Prompt: "x"})
	if err == nil || !contains(err.Error(), "403") {
		t.Fatalf("expected an error mentioning the 403 status, got: %v", err)
	}
}
