package aiclient

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
)

func allStructuredProtocolKinds() []Kind {
	return []Kind{KindOpenAICompat, KindAnthropic}
}

type structuredFixtureCapture struct {
	calls atomic.Int32
	mu    sync.Mutex
	body  map[string]any
}

func (c *structuredFixtureCapture) recordBody(body map[string]any) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.body = body
}

func (c *structuredFixtureCapture) requestBody() map[string]any {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.body
}

func structuredFixtureServer(t *testing.T, kind Kind, result, returnedToolName string, malformed bool) (*httptest.Server, *structuredFixtureCapture) {
	t.Helper()
	capture := &structuredFixtureCapture{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		capture.calls.Add(1)
		var requestBody map[string]any
		if err := json.NewDecoder(r.Body).Decode(&requestBody); err != nil {
			t.Errorf("decode structured request: %v", err)
		}
		capture.recordBody(requestBody)
		w.Header().Set("Content-Type", "application/json")
		if malformed {
			if kind == KindOpenAICompat {
				_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"not json"}}]}`))
				return
			}
			_, _ = w.Write([]byte(`{"content":[`))
			return
		}
		if kind == KindOpenAICompat {
			_, _ = fmt.Fprintf(w, `{"choices":[{"message":{"content":%s}}]}`, jsonString(result))
			return
		}
		_, _ = fmt.Fprintf(w, `{"content":[{"type":"tool_use","id":"t1","name":%s,"input":%s}]}`,
			jsonString(returnedToolName), result)
	}))
	t.Cleanup(srv.Close)
	return srv, capture
}

func structuredRequest(kind Kind, baseURL, name string, schema []byte) Request {
	return Request{
		Kind: kind, BaseURL: baseURL, Model: "fixture-model", Prompt: "fixture prompt",
		Schema: &SchemaSpec{Name: name, Schema: schema},
	}
}

func assertStructuredEnvelope(t *testing.T, kind Kind, body map[string]any, name string, schema []byte) {
	t.Helper()
	var wantSchema any
	if err := json.Unmarshal(schema, &wantSchema); err != nil {
		t.Fatalf("decode expected schema: %v", err)
	}

	var gotSchema any
	switch kind {
	case KindOpenAICompat:
		responseFormat, ok := body["response_format"].(map[string]any)
		if !ok || responseFormat["type"] != "json_schema" {
			t.Fatalf("response_format = %#v, want json_schema", body["response_format"])
		}
		wrapped, ok := responseFormat["json_schema"].(map[string]any)
		if !ok {
			t.Fatalf("response_format.json_schema = %#v, want object", responseFormat["json_schema"])
		}
		if wrapped["name"] != name || wrapped["strict"] != true {
			t.Errorf("json_schema name/strict = %v/%v, want %q/true", wrapped["name"], wrapped["strict"], name)
		}
		gotSchema = wrapped["schema"]
	case KindAnthropic:
		choice, ok := body["tool_choice"].(map[string]any)
		if !ok || choice["type"] != "tool" || choice["name"] != name {
			t.Fatalf("tool_choice = %#v, want forced tool %q", body["tool_choice"], name)
		}
		tools, ok := body["tools"].([]any)
		if !ok || len(tools) != 1 {
			t.Fatalf("tools = %#v, want one tool", body["tools"])
		}
		tool, ok := tools[0].(map[string]any)
		if !ok || tool["name"] != name {
			t.Fatalf("tool = %#v, want name %q", tools[0], name)
		}
		gotSchema = tool["input_schema"]
	}
	if !reflect.DeepEqual(gotSchema, wantSchema) {
		t.Errorf("wire schema = %#v, want exact supplied schema %#v", gotSchema, wantSchema)
	}
}

func TestCompleteStructuredOutput_ValidNestedLocalReference(t *testing.T) {
	schema := []byte(`{
		"$defs":{"item":{"type":"object","properties":{"label":{"type":"string"}},"required":["label"],"additionalProperties":false}},
		"type":"object","properties":{"items":{"type":"array","items":{"$ref":"#/$defs/item"}}},
		"required":["items"],"additionalProperties":false
	}`)
	resultJSON := `{"items":[{"label":"first"},{"label":"second"}]}`
	for _, kind := range allStructuredProtocolKinds() {
		t.Run(string(kind), func(t *testing.T) {
			const schemaName = "nested_result"
			srv, capture := structuredFixtureServer(t, kind, resultJSON, schemaName, false)
			result, err := Complete(structuredRequest(kind, srv.URL, schemaName, schema))
			if err != nil {
				t.Fatalf("Complete: %v", err)
			}
			if string(result.JSON) != resultJSON || result.Text != resultJSON {
				t.Errorf("result = %#v, want JSON and Text to preserve %s", result, resultJSON)
			}
			if capture.calls.Load() != 1 {
				t.Fatalf("provider calls = %d, want 1", capture.calls.Load())
			}
			assertStructuredEnvelope(t, kind, capture.requestBody(), schemaName, schema)
		})
	}
}

func TestCompleteStructuredOutput_InvalidSchemaMakesNoRequest(t *testing.T) {
	var externalSchemaCalls atomic.Int32
	externalSchema := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		externalSchemaCalls.Add(1)
		_, _ = w.Write([]byte(`{"type":"object"}`))
	}))
	t.Cleanup(externalSchema.Close)
	externalSchemaPath := filepath.Join(t.TempDir(), "schema.json")
	if err := os.WriteFile(externalSchemaPath, []byte(`{"type":"object"}`), 0o600); err != nil {
		t.Fatalf("write external schema fixture: %v", err)
	}

	networkRef := []byte(fmt.Sprintf(`{"$ref":%s}`, jsonString(externalSchema.URL+"/schema.json")))
	fileRef := []byte(fmt.Sprintf(`{"$ref":%s}`, jsonString((&url.URL{Scheme: "file", Path: externalSchemaPath}).String())))
	tests := []struct {
		name   string
		schema []byte
	}{
		{name: "malformed JSON", schema: []byte(`{"type":`)},
		{name: "invalid schema", schema: []byte(`{"type":"not-a-type"}`)},
		{name: "network reference", schema: networkRef},
		{name: "file reference", schema: fileRef},
	}
	for _, kind := range allStructuredProtocolKinds() {
		for _, tt := range tests {
			t.Run(string(kind)+"/"+tt.name, func(t *testing.T) {
				srv, capture := structuredFixtureServer(t, kind, `{}`, "result", false)
				_, err := Complete(structuredRequest(kind, srv.URL, "result", tt.schema))
				if !errors.Is(err, ErrInvalidSchema) {
					t.Fatalf("Complete error = %v, want ErrInvalidSchema", err)
				}
				if capture.calls.Load() != 0 {
					t.Errorf("provider calls = %d, want 0", capture.calls.Load())
				}
			})
		}
	}
	if externalSchemaCalls.Load() != 0 {
		t.Errorf("external schema requests = %d, want 0", externalSchemaCalls.Load())
	}
}

func TestCompleteStructuredOutput_RejectsNonconformingResults(t *testing.T) {
	schema := []byte(`{
		"type":"object",
		"properties":{
			"name":{"type":"string"},
			"count":{"type":"integer"},
			"choice":{"type":"string","enum":["one","two"]},
			"nested":{"type":"object","properties":{"enabled":{"type":"boolean"}},"required":["enabled"],"additionalProperties":false}
		},
		"required":["name","count","choice","nested"],
		"additionalProperties":false
	}`)
	valid := `{"name":"fixture","count":1,"choice":"one","nested":{"enabled":true}}`
	tests := []struct {
		name      string
		result    string
		malformed bool
	}{
		{name: "malformed JSON", malformed: true},
		{name: "null", result: `null`},
		{name: "array instead of object", result: `[]`},
		{name: "wrong type", result: strings.Replace(valid, `"count":1`, `"count":"one"`, 1)},
		{name: "missing required", result: `{"name":"fixture","count":1,"choice":"one"}`},
		{name: "forbidden extra", result: strings.Replace(valid, `"name":"fixture"`, `"name":"fixture","extra":true`, 1)},
		{name: "invalid enum", result: strings.Replace(valid, `"choice":"one"`, `"choice":"three"`, 1)},
		{name: "invalid nested", result: strings.Replace(valid, `"enabled":true`, `"enabled":"yes"`, 1)},
	}
	for _, kind := range allStructuredProtocolKinds() {
		for _, tt := range tests {
			t.Run(string(kind)+"/"+tt.name, func(t *testing.T) {
				srv, capture := structuredFixtureServer(t, kind, tt.result, "result", tt.malformed)
				_, err := Complete(structuredRequest(kind, srv.URL, "result", schema))
				if !errors.Is(err, ErrInvalidStructuredResult) {
					t.Fatalf("Complete error = %v, want ErrInvalidStructuredResult", err)
				}
				if capture.calls.Load() != 1 {
					t.Errorf("provider calls = %d, want 1", capture.calls.Load())
				}
			})
		}
	}
}

func TestCompleteStructuredOutput_AllowsExtraWhenSchemaDoes(t *testing.T) {
	schema := []byte(`{"type":"object","properties":{"name":{"type":"string"}},"required":["name"],"additionalProperties":true}`)
	resultJSON := `{"name":"fixture","extra":{"nested":true}}`
	for _, kind := range allStructuredProtocolKinds() {
		t.Run(string(kind), func(t *testing.T) {
			srv, _ := structuredFixtureServer(t, kind, resultJSON, "result", false)
			if _, err := Complete(structuredRequest(kind, srv.URL, "result", schema)); err != nil {
				t.Fatalf("Complete: %v", err)
			}
		})
	}
}

func TestCompleteAnthropic_WrongToolNameIsInvalidStructuredResult(t *testing.T) {
	schema := []byte(`{"type":"object"}`)
	srv, capture := structuredFixtureServer(t, KindAnthropic, `{}`, "different_tool", false)
	_, err := Complete(structuredRequest(KindAnthropic, srv.URL, "requested_tool", schema))
	if !errors.Is(err, ErrInvalidStructuredResult) {
		t.Fatalf("Complete error = %v, want ErrInvalidStructuredResult", err)
	}
	if capture.calls.Load() != 1 {
		t.Errorf("provider calls = %d, want 1", capture.calls.Load())
	}
}

func TestStructuredValidationErrorsDoNotExposeInputs(t *testing.T) {
	invalidSchema := []byte(`{"secret-schema-marker":`)
	_, err := Complete(Request{
		Kind: KindOpenAICompat, BaseURL: "http://secret-endpoint-marker.invalid", Model: "secret-model-marker",
		Prompt: "secret-prompt-marker", Schema: &SchemaSpec{Name: "secret-name-marker", Schema: invalidSchema},
	})
	if !errors.Is(err, ErrInvalidSchema) {
		t.Fatalf("Complete error = %v, want ErrInvalidSchema", err)
	}
	for _, marker := range []string{"secret-schema-marker", "secret-endpoint-marker", "secret-model-marker", "secret-prompt-marker", "secret-name-marker"} {
		if strings.Contains(err.Error(), marker) {
			t.Errorf("schema error exposed %q", marker)
		}
	}

	schema := []byte(`{"type":"object","required":["requiredField"]}`)
	srv, _ := structuredFixtureServer(t, KindOpenAICompat, `{"secret-result-marker":true}`, "result", false)
	_, err = Complete(structuredRequest(KindOpenAICompat, srv.URL, "result", schema))
	if !errors.Is(err, ErrInvalidStructuredResult) {
		t.Fatalf("Complete error = %v, want ErrInvalidStructuredResult", err)
	}
	if strings.Contains(err.Error(), "secret-result-marker") {
		t.Error("structured-result error exposed the raw provider result")
	}
}
