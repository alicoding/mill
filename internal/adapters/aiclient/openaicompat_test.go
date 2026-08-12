package aiclient

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// fixtureOpenAICompatServer speaks the OpenAI-compatible
// /v1/chat/completions shape deterministically -- the CI-provable proof
// layer docs/goals/0031-ai-node-family.md item 4 asks for (no real
// model, no network dependency). Records the last decoded request body
// for assertions on what this adapter actually sent.
func fixtureOpenAICompatServer(t *testing.T, reply string) (*httptest.Server, *map[string]any) {
	t.Helper()
	var lastBody map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/chat/completions" {
			t.Errorf("unexpected path %q", r.URL.Path)
		}
		if err := json.NewDecoder(r.Body).Decode(&lastBody); err != nil {
			t.Fatalf("decode request body: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":` + jsonString(reply) + `}}]}`))
	}))
	t.Cleanup(srv.Close)
	return srv, &lastBody
}

func jsonString(s string) string {
	b, _ := json.Marshal(s)
	return string(b)
}

func TestCompleteOpenAICompat_PlainText(t *testing.T) {
	srv, lastBody := fixtureOpenAICompatServer(t, "hello from the fixture model")
	result, err := Complete(Request{
		Kind: KindOpenAICompat, BaseURL: srv.URL, Model: "llama3.2",
		System: "be terse", Prompt: "say hi",
	})
	if err != nil {
		t.Fatalf("Complete: %v", err)
	}
	if result.Text != "hello from the fixture model" {
		t.Errorf("Text = %q, want the fixture's reply", result.Text)
	}
	if result.JSON != nil {
		t.Errorf("JSON should be nil for a plain-text request, got %s", result.JSON)
	}
	messages, _ := (*lastBody)["messages"].([]any)
	if len(messages) != 2 {
		t.Fatalf("expected 2 messages (system + user), got %d: %v", len(messages), *lastBody)
	}
}

func TestCompleteOpenAICompat_NoAPIKeyMeansNoAuthHeader(t *testing.T) {
	var sawAuth bool
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		sawAuth = r.Header.Get("Authorization") != ""
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"ok"}}]}`))
	}))
	t.Cleanup(srv.Close)
	if _, err := Complete(Request{Kind: KindOpenAICompat, BaseURL: srv.URL, Model: "llama3.2", Prompt: "hi"}); err != nil {
		t.Fatalf("Complete: %v", err)
	}
	if sawAuth {
		t.Error("expected no Authorization header for an empty APIKey (local Ollama has no credential)")
	}
}

func TestCompleteOpenAICompat_APIKeySentAsBearer(t *testing.T) {
	var gotAuth string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"ok"}}]}`))
	}))
	t.Cleanup(srv.Close)
	if _, err := Complete(Request{Kind: KindOpenAICompat, BaseURL: srv.URL, Model: "gpt-4o-mini", APIKey: "sk-test", Prompt: "hi"}); err != nil {
		t.Fatalf("Complete: %v", err)
	}
	if gotAuth != "Bearer sk-test" {
		t.Errorf("Authorization = %q, want %q", gotAuth, "Bearer sk-test")
	}
}

func TestCompleteOpenAICompat_StructuredOutput(t *testing.T) {
	srv, lastBody := fixtureOpenAICompatServer(t, `{"category":"invoice","confidence":0.9}`)
	result, err := Complete(Request{
		Kind: KindOpenAICompat, BaseURL: srv.URL, Model: "llama3.2",
		Prompt: "classify this",
		Schema: &SchemaSpec{Name: "classification", Schema: []byte(`{"type":"object","properties":{"category":{"type":"string"}}}`)},
	})
	if err != nil {
		t.Fatalf("Complete: %v", err)
	}
	if string(result.JSON) != `{"category":"invoice","confidence":0.9}` {
		t.Errorf("JSON = %s, want the fixture's structured reply", result.JSON)
	}
	rf, _ := (*lastBody)["response_format"].(map[string]any)
	if rf["type"] != "json_schema" {
		t.Errorf("expected response_format.type == json_schema, got %v", rf)
	}
}

func TestCompleteOpenAICompat_StructuredOutputRejectsNonJSON(t *testing.T) {
	srv, _ := fixtureOpenAICompatServer(t, "not json at all")
	_, err := Complete(Request{
		Kind: KindOpenAICompat, BaseURL: srv.URL, Model: "llama3.2", Prompt: "x",
		Schema: &SchemaSpec{Name: "s", Schema: []byte(`{"type":"object"}`)},
	})
	if err == nil {
		t.Fatal("expected an error when structured output was requested but the model returned non-JSON text")
	}
}

func TestCompleteOpenAICompat_NonSuccessStatus(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"error":"invalid api key"}`))
	}))
	t.Cleanup(srv.Close)
	_, err := Complete(Request{Kind: KindOpenAICompat, BaseURL: srv.URL, Model: "m", Prompt: "x"})
	if err == nil || !strings.Contains(err.Error(), "401") {
		t.Fatalf("expected an error mentioning the 401 status, got: %v", err)
	}
}
