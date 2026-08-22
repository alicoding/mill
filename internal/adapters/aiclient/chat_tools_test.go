package aiclient

import (
	"encoding/json"
	"strings"
	"testing"
)

// TestChatOpenAICompat_StreamedThenToolCall_ReturnsTextAndCall proves a
// turn that streams reasoning text before calling a tool ends its
// stream the moment the call completes (goal 0101 slice 1's own
// contract: "text deltas stream; a completed tool call ends the turn's
// stream") -- deltas keep arriving through onDelta exactly like a
// text-only turn, and the finished ToolCall carries the accumulated
// name/arguments once finish_reason lands.
func TestChatOpenAICompat_StreamedThenToolCall_ReturnsTextAndCall(t *testing.T) {
	srv := fixtureOpenAICompatStream(t, []string{
		`{"choices":[{"delta":{"content":"Checking "}}]}`,
		`{"choices":[{"delta":{"content":"the kinds..."}}]}`,
		`{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"atlas_list_kinds","arguments":""}}]}}]}`,
		`{"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\"query\":"}}]}}]}`,
		`{"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\"topic\"}"}}]}}]}`,
		`{"choices":[{"finish_reason":"tool_calls"}]}`,
	}, true)
	var deltas []string
	res, err := Chat(ChatRequest{
		Kind: KindOpenAICompat, BaseURL: srv.URL, Model: "m",
		Messages: []ChatMessage{{Role: "user", Content: "what topics exist?"}},
		Tools:    []ToolDef{{Name: "atlas_list_kinds", Description: "list kinds", InputSchema: []byte(`{"type":"object"}`)}},
	}, func(d string) { deltas = append(deltas, d) })
	if err != nil {
		t.Fatalf("Chat: %v", err)
	}
	if res.Text != "Checking the kinds..." {
		t.Errorf("Text = %q", res.Text)
	}
	if len(deltas) != 2 {
		t.Errorf("deltas = %v, want 2 text fragments streamed before the call", deltas)
	}
	if len(res.ToolCalls) != 1 {
		t.Fatalf("ToolCalls = %+v, want exactly 1", res.ToolCalls)
	}
	tc := res.ToolCalls[0]
	if tc.ID != "call_1" || tc.Name != "atlas_list_kinds" {
		t.Errorf("ToolCalls[0] = %+v", tc)
	}
	var args map[string]string
	if err := json.Unmarshal(tc.Arguments, &args); err != nil || args["query"] != "topic" {
		t.Errorf("ToolCalls[0].Arguments = %s, want {\"query\":\"topic\"}", tc.Arguments)
	}
}

// TestChatOpenAICompat_ParallelToolCalls_ReturnsBothInOrder proves Chat
// parses every call in one turn when a provider streams more than
// one, interleaved by index -- execution ORDER/sequencing is
// agentloopsvc's own responsibility (v1 runs them one at a time), this
// layer only needs to hand back every call the wire shape reported, in
// the order each index first appeared.
func TestChatOpenAICompat_ParallelToolCalls_ReturnsBothInOrder(t *testing.T) {
	srv := fixtureOpenAICompatStream(t, []string{
		`{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_a","function":{"name":"atlas_list_kinds","arguments":"{}"}}]}}]}`,
		`{"choices":[{"delta":{"tool_calls":[{"index":1,"id":"call_b","function":{"name":"atlas_search_cards","arguments":""}}]}}]}`,
		`{"choices":[{"delta":{"tool_calls":[{"index":1,"function":{"arguments":"{\"q\":\"ada\"}"}}]}}]}`,
		`{"choices":[{"finish_reason":"tool_calls"}]}`,
	}, true)
	res, err := Chat(ChatRequest{
		Kind: KindOpenAICompat, BaseURL: srv.URL, Model: "m",
		Messages: []ChatMessage{{Role: "user", Content: "look things up"}},
		Tools: []ToolDef{
			{Name: "atlas_list_kinds", InputSchema: []byte(`{}`)},
			{Name: "atlas_search_cards", InputSchema: []byte(`{}`)},
		},
	}, func(string) {})
	if err != nil {
		t.Fatalf("Chat: %v", err)
	}
	if len(res.ToolCalls) != 2 {
		t.Fatalf("ToolCalls = %+v, want 2 parallel calls", res.ToolCalls)
	}
	if res.ToolCalls[0].Name != "atlas_list_kinds" || res.ToolCalls[1].Name != "atlas_search_cards" {
		t.Errorf("ToolCalls = %+v, want atlas_list_kinds then atlas_search_cards", res.ToolCalls)
	}
	if string(res.ToolCalls[1].Arguments) != `{"q":"ada"}` {
		t.Errorf("ToolCalls[1].Arguments = %s", res.ToolCalls[1].Arguments)
	}
}

// TestChatOpenAICompat_RequestBody_CarriesToolDefs proves the tools
// array actually reaches the wire -- a provider can't call a tool it
// was never told about.
func TestChatOpenAICompat_RequestBody_CarriesToolDefs(t *testing.T) {
	var gotBody string
	srv := fixtureOpenAICompatCapture(t, &gotBody)
	_, err := Chat(ChatRequest{
		Kind: KindOpenAICompat, BaseURL: srv.URL, Model: "m",
		Messages: []ChatMessage{{Role: "user", Content: "hi"}},
		Tools:    []ToolDef{{Name: "check_write_status", Description: "poll a write", InputSchema: []byte(`{"type":"object"}`)}},
	}, func(string) {})
	if err != nil {
		t.Fatalf("Chat: %v", err)
	}
	for _, want := range []string{`"tools"`, `"check_write_status"`, `"type":"function"`} {
		if !strings.Contains(gotBody, want) {
			t.Errorf("request body %s missing %s", gotBody, want)
		}
	}
}

// TestChatAnthropic_StreamedThenToolCall_ReturnsTextAndCall mirrors
// TestChatOpenAICompat_StreamedThenToolCall_ReturnsTextAndCall for
// Anthropic's own content_block_start/input_json_delta shape.
func TestChatAnthropic_StreamedThenToolCall_ReturnsTextAndCall(t *testing.T) {
	srv := fixtureAnthropicStream(t, [][2]string{
		{"content_block_delta", `{"index":0,"delta":{"type":"text_delta","text":"Checking..."}}`},
		{"content_block_start", `{"index":1,"content_block":{"type":"tool_use","id":"toolu_1","name":"atlas_list_kinds"}}`},
		{"content_block_delta", `{"index":1,"delta":{"type":"input_json_delta","partial_json":"{\"query\":"}}`},
		{"content_block_delta", `{"index":1,"delta":{"type":"input_json_delta","partial_json":"\"topic\"}"}}`},
		{"message_stop", `{"type":"message_stop"}`},
	})
	res, err := Chat(ChatRequest{
		Kind: KindAnthropic, BaseURL: srv.URL, Model: "claude-sonnet-4-5",
		Messages: []ChatMessage{{Role: "user", Content: "what topics exist?"}},
		Tools:    []ToolDef{{Name: "atlas_list_kinds", InputSchema: []byte(`{"type":"object"}`)}},
	}, func(string) {})
	if err != nil {
		t.Fatalf("Chat: %v", err)
	}
	if res.Text != "Checking..." {
		t.Errorf("Text = %q", res.Text)
	}
	if len(res.ToolCalls) != 1 || res.ToolCalls[0].ID != "toolu_1" || res.ToolCalls[0].Name != "atlas_list_kinds" {
		t.Fatalf("ToolCalls = %+v", res.ToolCalls)
	}
	var args map[string]string
	if err := json.Unmarshal(res.ToolCalls[0].Arguments, &args); err != nil || args["query"] != "topic" {
		t.Errorf("ToolCalls[0].Arguments = %s", res.ToolCalls[0].Arguments)
	}
}

// TestChatAnthropic_ParallelToolCalls_ReturnsBothInOrder mirrors the
// OpenAI-compat parallel-calls test for Anthropic's own multiple
// tool_use content blocks in one turn.
func TestChatAnthropic_ParallelToolCalls_ReturnsBothInOrder(t *testing.T) {
	srv := fixtureAnthropicStream(t, [][2]string{
		{"content_block_start", `{"index":0,"content_block":{"type":"tool_use","id":"toolu_a","name":"atlas_list_kinds"}}`},
		{"content_block_delta", `{"index":0,"delta":{"type":"input_json_delta","partial_json":"{}"}}`},
		{"content_block_start", `{"index":1,"content_block":{"type":"tool_use","id":"toolu_b","name":"atlas_search_cards"}}`},
		{"content_block_delta", `{"index":1,"delta":{"type":"input_json_delta","partial_json":"{\"q\":\"ada\"}"}}`},
		{"message_stop", `{"type":"message_stop"}`},
	})
	res, err := Chat(ChatRequest{
		Kind: KindAnthropic, BaseURL: srv.URL, Model: "claude-sonnet-4-5",
		Messages: []ChatMessage{{Role: "user", Content: "look things up"}},
		Tools: []ToolDef{
			{Name: "atlas_list_kinds", InputSchema: []byte(`{}`)},
			{Name: "atlas_search_cards", InputSchema: []byte(`{}`)},
		},
	}, func(string) {})
	if err != nil {
		t.Fatalf("Chat: %v", err)
	}
	if len(res.ToolCalls) != 2 {
		t.Fatalf("ToolCalls = %+v, want 2 parallel calls", res.ToolCalls)
	}
	if res.ToolCalls[0].Name != "atlas_list_kinds" || res.ToolCalls[1].Name != "atlas_search_cards" {
		t.Errorf("ToolCalls = %+v, want atlas_list_kinds then atlas_search_cards", res.ToolCalls)
	}
	if string(res.ToolCalls[1].Arguments) != `{"q":"ada"}` {
		t.Errorf("ToolCalls[1].Arguments = %s", res.ToolCalls[1].Arguments)
	}
}

// TestChatAnthropic_RequestBody_CarriesToolDefs mirrors the
// OpenAI-compat wire-body assertion for Anthropic's own tools array
// shape (name/description/input_schema, no tool_choice -- a chat turn
// always leaves the model free to decide, unlike completeAnthropic's
// forced-tool-choice structured-output use of this same field).
func TestChatAnthropic_RequestBody_CarriesToolDefs(t *testing.T) {
	var gotBody string
	srv := fixtureAnthropicCapture(t, &gotBody)
	_, err := Chat(ChatRequest{
		Kind: KindAnthropic, BaseURL: srv.URL, Model: "claude-sonnet-4-5",
		Messages: []ChatMessage{{Role: "user", Content: "hi"}},
		Tools:    []ToolDef{{Name: "check_write_status", Description: "poll a write", InputSchema: []byte(`{"type":"object"}`)}},
	}, func(string) {})
	if err != nil {
		t.Fatalf("Chat: %v", err)
	}
	for _, want := range []string{`"tools"`, `"check_write_status"`, `"input_schema"`} {
		if !strings.Contains(gotBody, want) {
			t.Errorf("request body %s missing %s", gotBody, want)
		}
	}
	if strings.Contains(gotBody, `"tool_choice"`) {
		t.Errorf("a chat turn must never force tool_choice, got body %s", gotBody)
	}
}

// TestChat_ToolResultRoundTrip_SendsCorrelatedTurns proves a "tool"
// role ChatMessage (a completed call's result, fed back for the next
// turn) reaches the wire correctly for both shapes: OpenAI's
// tool_call_id-correlated message, and Anthropic's tool_result content
// block inside a user turn (this API has no literal "tool" role).
func TestChat_ToolResultRoundTrip_SendsCorrelatedTurns(t *testing.T) {
	t.Run("openai-compatible", func(t *testing.T) {
		var gotBody string
		srv := fixtureOpenAICompatCapture(t, &gotBody)
		_, err := Chat(ChatRequest{
			Kind: KindOpenAICompat, BaseURL: srv.URL, Model: "m",
			Messages: []ChatMessage{
				{Role: "user", Content: "list the kinds"},
				{Role: "assistant", ToolCalls: []ToolCall{{ID: "call_1", Name: "atlas_list_kinds", Arguments: json.RawMessage(`{}`)}}},
				{Role: "tool", ToolCallID: "call_1", Content: `["Topic"]`},
			},
		}, func(string) {})
		if err != nil {
			t.Fatalf("Chat: %v", err)
		}
		for _, want := range []string{`"tool_call_id":"call_1"`, `"role":"tool"`, `Topic`} {
			if !strings.Contains(gotBody, want) {
				t.Errorf("request body %s missing %s", gotBody, want)
			}
		}
	})
	t.Run("anthropic", func(t *testing.T) {
		var gotBody string
		srv := fixtureAnthropicCapture(t, &gotBody)
		_, err := Chat(ChatRequest{
			Kind: KindAnthropic, BaseURL: srv.URL, Model: "claude-sonnet-4-5",
			Messages: []ChatMessage{
				{Role: "user", Content: "list the kinds"},
				{Role: "assistant", ToolCalls: []ToolCall{{ID: "toolu_1", Name: "atlas_list_kinds", Arguments: json.RawMessage(`{}`)}}},
				{Role: "tool", ToolCallID: "toolu_1", Content: `["Topic"]`},
			},
		}, func(string) {})
		if err != nil {
			t.Fatalf("Chat: %v", err)
		}
		for _, want := range []string{`"tool_use_id":"toolu_1"`, `"type":"tool_result"`, `Topic`} {
			if !strings.Contains(gotBody, want) {
				t.Errorf("request body %s missing %s", gotBody, want)
			}
		}
	})
}
