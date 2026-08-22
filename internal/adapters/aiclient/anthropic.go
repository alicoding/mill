package aiclient

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"

	"github.com/alicoding/mill/internal/adapters/httpconnector"
)

// defaultAnthropicBaseURL mirrors aiprovider.DefaultAnthropicBaseURL --
// duplicated as a plain string constant (not imported) to keep this
// package domain-agnostic (this file's own doc comment); a wire-value
// unit test (anthropic_test.go) keeps the two from drifting apart.
const defaultAnthropicBaseURL = "https://api.anthropic.com"

// anthropicVersion is the API version header Anthropic's Messages API
// requires on every request -- confirmed current against Anthropic's
// own published API reference before building (docs/goals/0031 item 1).
const anthropicVersion = "2023-06-01"

// effectiveAnthropicBaseURL resolves a blank BaseURL to Anthropic's own
// real host -- a pure, directly-testable function so anthropic_test.go
// can prove the fallback without ever making a real network call in
// CI (docs/goals/0031-ai-node-family.md item 4: "CI never needs a
// model").
func effectiveAnthropicBaseURL(base string) string {
	if base == "" {
		return defaultAnthropicBaseURL
	}
	return base
}

// completeAnthropic speaks Anthropic's native Messages API
// (POST /v1/messages, x-api-key + anthropic-version headers) --
// deliberately NOT Anthropic's OpenAI-compatible shim, which Anthropic's
// own docs disqualify for production use (docs/goals/0031 item 1's
// research verdict). Structured output has no response_format/
// json_schema concept on this API; the established, reliable pattern
// (Anthropic's own docs' recommended approach) is a single forced tool
// call: one tool is declared with input_schema set to the caller's
// requested JSON Schema, tool_choice forces the model to call exactly
// that tool, and the tool_use block's `input` IS the structured result
// -- no free-text parsing involved.
func completeAnthropic(req Request) (Result, error) {
	baseURL := effectiveAnthropicBaseURL(req.BaseURL)

	body := map[string]any{
		"model":      req.Model,
		"max_tokens": 4096,
		"messages":   []map[string]string{{"role": "user", "content": req.Prompt}},
	}
	if req.System != "" {
		body["system"] = req.System
	}
	var toolName string
	if req.Schema != nil {
		toolName = schemaName(req.Schema.Name)
		body["tools"] = []map[string]any{
			{
				"name":         toolName,
				"description":  "Extract the requested structured result.",
				"input_schema": json.RawMessage(req.Schema.Schema),
			},
		}
		body["tool_choice"] = map[string]any{"type": "tool", "name": toolName}
	}
	data, err := json.Marshal(body)
	if err != nil {
		return Result{}, fmt.Errorf("anthropic: encode request: %w", err)
	}

	headers := map[string]string{
		"Content-Type":      "application/json",
		"anthropic-version": anthropicVersion,
	}
	if req.APIKey != "" {
		headers["x-api-key"] = req.APIKey
	}

	resp, err := httpconnector.Execute(httpconnector.Request{
		Method: "POST", URL: strings.TrimRight(baseURL, "/") + "/v1/messages",
		Headers: headers, Body: string(data),
	})
	if err != nil {
		return Result{}, fmt.Errorf("anthropic: %w", err)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return Result{}, fmt.Errorf("anthropic: unexpected status %d: %s", resp.StatusCode, truncate(resp.Body))
	}

	var parsed struct {
		Content []struct {
			Type  string          `json:"type"`
			Text  string          `json:"text"`
			Name  string          `json:"name"`
			Input json.RawMessage `json:"input"`
		} `json:"content"`
	}
	if err := json.Unmarshal([]byte(resp.Body), &parsed); err != nil {
		return Result{}, fmt.Errorf("anthropic: parse response: %w", err)
	}

	if req.Schema != nil {
		for _, block := range parsed.Content {
			if block.Type == "tool_use" && block.Name == toolName {
				return Result{Text: string(block.Input), JSON: block.Input}, nil
			}
		}
		return Result{}, fmt.Errorf("anthropic: expected a tool_use block for structured output, got none")
	}

	var text strings.Builder
	for _, block := range parsed.Content {
		if block.Type == "text" {
			text.WriteString(block.Text)
		}
	}
	return Result{Text: text.String()}, nil
}

// chatAnthropic speaks Anthropic's native Messages API with
// "stream": true -- confirmed against Anthropic's own published
// streaming docs before building (docs/goals/0101 item 1): a
// content_block_delta event's delta.text is the next text fragment
// (delta.type == "text_delta"); a tool call streams as a
// content_block_start event (type "tool_use", carrying the call's id
// and name) followed by zero or more content_block_delta events (type
// "input_json_delta", carrying the arguments object's JSON one
// fragment at a time). An error event carries a terminal failure, and
// message_stop ends the stream.
// anthropicChatMessages converts a chat conversation's turns into the
// Messages API's own role/content shape -- widened to []map[string]any
// (from plain string content) so a tool-use or tool-result turn's
// content-block-array shape fits alongside plain text turns.
func anthropicChatMessages(turns []ChatMessage) []map[string]any {
	messages := make([]map[string]any, 0, len(turns))
	for _, m := range turns {
		messages = append(messages, anthropicOneMessage(m))
	}
	return messages
}

// anthropicOneMessage renders a single ChatMessage in the Messages
// API's own shape -- split out of anthropicChatMessages purely to keep
// that function's own cognitive complexity under the repo's gate. An
// assistant turn carrying ToolCalls sends each as a tool_use content
// block (Arguments parsed back into an object -- Anthropic's "input" is
// a JSON object, never a string, unlike OpenAI's own wire shape); a
// "tool" turn has no such role on this API, so it's sent as Anthropic's
// own documented shape instead: a "user" message whose content is a
// single tool_result block naming ToolCallID.
func anthropicOneMessage(m ChatMessage) map[string]any {
	switch {
	case m.Role == "assistant" && len(m.ToolCalls) > 0:
		content := []map[string]any{}
		if m.Content != "" {
			content = append(content, map[string]any{"type": "text", "text": m.Content})
		}
		for _, tc := range m.ToolCalls {
			var input any = map[string]any{}
			if len(tc.Arguments) > 0 {
				_ = json.Unmarshal(tc.Arguments, &input)
			}
			content = append(content, map[string]any{"type": "tool_use", "id": tc.ID, "name": tc.Name, "input": input})
		}
		return map[string]any{"role": "assistant", "content": content}
	case m.Role == "tool":
		return map[string]any{
			"role":    "user",
			"content": []map[string]any{{"type": "tool_result", "tool_use_id": m.ToolCallID, "content": m.Content}},
		}
	default:
		return map[string]any{"role": m.Role, "content": m.Content}
	}
}

// anthropicToolDefs renders ChatRequest.Tools as Anthropic's own tools
// array shape -- nil (the "tools" key omitted entirely) when the
// caller passed none. Unlike completeAnthropic's structured-output
// forced-tool-choice use of this same API, a chat turn never sets
// tool_choice -- the model decides for itself whether to call a tool,
// same as OpenAI's default "auto".
func anthropicToolDefs(tools []ToolDef) []map[string]any {
	if len(tools) == 0 {
		return nil
	}
	out := make([]map[string]any, 0, len(tools))
	for _, t := range tools {
		out = append(out, map[string]any{
			"name": t.Name, "description": t.Description, "input_schema": json.RawMessage(t.InputSchema),
		})
	}
	return out
}

// anthropicToolBlockStart is a content_block_start event's contribution
// -- only populated when that block is a tool_use block (a plain text
// block start carries no id/name, and isn't tracked here since text
// deltas need no per-index accumulation).
type anthropicToolBlockStart struct {
	Index    int
	ID, Name string
}

// anthropicToolJSONDelta is one content_block_delta event's
// input_json_delta fragment for the tool_use block at Index.
type anthropicToolJSONDelta struct {
	Index    int
	Fragment string
}

// anthropicStreamDelta is one decoded event's contribution to the turn
// in progress.
type anthropicStreamDelta struct {
	Text           string
	ToolBlockStart *anthropicToolBlockStart
	ToolJSONDelta  *anthropicToolJSONDelta
}

// parseAnthropicEvent decodes one Anthropic SSE (event, data) pair
// into its contribution to the turn -- split out of chatAnthropic's
// scanSSE closure purely to keep that function's own cognitive
// complexity under the repo's gate. stop reports message_stop (or any
// decode/error-event failure, carried in err); every other event
// contributes no delta. Returned unprefixed -- chatAnthropic wraps it
// with the provider/endpoint that failed at its own return site, the
// one place that prefix gets added.
func parseAnthropicEvent(event, data string) (out anthropicStreamDelta, stop bool, err error) {
	switch event {
	case "content_block_start":
		return parseAnthropicBlockStart(data)
	case "content_block_delta":
		return parseAnthropicBlockDelta(data)
	case "error":
		var e struct {
			Error struct {
				Message string `json:"message"`
			} `json:"error"`
		}
		_ = json.Unmarshal([]byte(data), &e)
		return anthropicStreamDelta{}, true, errors.New(e.Error.Message)
	case "message_stop":
		return anthropicStreamDelta{}, true, nil
	default:
		return anthropicStreamDelta{}, false, nil
	}
}

// parseAnthropicBlockStart decodes one content_block_start event --
// split out of parseAnthropicEvent purely to keep that function's own
// cognitive complexity under the repo's gate.
func parseAnthropicBlockStart(data string) (anthropicStreamDelta, bool, error) {
	var d struct {
		Index        int `json:"index"`
		ContentBlock struct {
			Type string `json:"type"`
			ID   string `json:"id"`
			Name string `json:"name"`
		} `json:"content_block"`
	}
	if err := json.Unmarshal([]byte(data), &d); err != nil {
		return anthropicStreamDelta{}, true, fmt.Errorf("parse stream event: %w", err)
	}
	if d.ContentBlock.Type != "tool_use" {
		return anthropicStreamDelta{}, false, nil
	}
	return anthropicStreamDelta{ToolBlockStart: &anthropicToolBlockStart{
		Index: d.Index, ID: d.ContentBlock.ID, Name: d.ContentBlock.Name,
	}}, false, nil
}

// parseAnthropicBlockDelta decodes one content_block_delta event --
// split out of parseAnthropicEvent purely to keep that function's own
// cognitive complexity under the repo's gate.
func parseAnthropicBlockDelta(data string) (anthropicStreamDelta, bool, error) {
	var d struct {
		Index int `json:"index"`
		Delta struct {
			Type        string `json:"type"`
			Text        string `json:"text"`
			PartialJSON string `json:"partial_json"`
		} `json:"delta"`
	}
	if err := json.Unmarshal([]byte(data), &d); err != nil {
		return anthropicStreamDelta{}, true, fmt.Errorf("parse stream event: %w", err)
	}
	switch d.Delta.Type {
	case "text_delta":
		return anthropicStreamDelta{Text: d.Delta.Text}, false, nil
	case "input_json_delta":
		return anthropicStreamDelta{ToolJSONDelta: &anthropicToolJSONDelta{Index: d.Index, Fragment: d.Delta.PartialJSON}}, false, nil
	default:
		return anthropicStreamDelta{}, false, nil
	}
}

// anthropicChatBody builds chatAnthropic's own request body -- split
// out purely to keep chatAnthropic's own cognitive complexity under
// the repo's gate.
func anthropicChatBody(req ChatRequest) map[string]any {
	body := map[string]any{
		"model": req.Model, "max_tokens": 4096, "messages": anthropicChatMessages(req.Messages), "stream": true,
	}
	if req.System != "" {
		body["system"] = req.System
	}
	if defs := anthropicToolDefs(req.Tools); defs != nil {
		body["tools"] = defs
	}
	return body
}

// mergeAnthropicStreamDelta folds one decoded event's contribution into
// the turn in progress (streamed text, and any tool-call
// start/argument fragment) -- split out of chatAnthropic's scanSSE
// closure purely to keep that function's own cognitive complexity under
// the repo's gate.
func mergeAnthropicStreamDelta(full *strings.Builder, onDelta func(string), calls map[int]*buildingToolCall, order *[]int, d anthropicStreamDelta) {
	if d.Text != "" {
		full.WriteString(d.Text)
		onDelta(d.Text)
	}
	if d.ToolBlockStart != nil {
		bc := &buildingToolCall{id: d.ToolBlockStart.ID, name: d.ToolBlockStart.Name}
		calls[d.ToolBlockStart.Index] = bc
		*order = append(*order, d.ToolBlockStart.Index)
	}
	if d.ToolJSONDelta != nil {
		if bc, ok := calls[d.ToolJSONDelta.Index]; ok {
			bc.args.WriteString(d.ToolJSONDelta.Fragment)
		}
	}
}

func chatAnthropic(req ChatRequest, onDelta func(string)) (ChatResult, error) {
	baseURL := effectiveAnthropicBaseURL(req.BaseURL)
	data, err := json.Marshal(anthropicChatBody(req))
	if err != nil {
		return ChatResult{}, fmt.Errorf("anthropic: encode request: %w", err)
	}

	headers := map[string]string{
		"Content-Type":      "application/json",
		"anthropic-version": anthropicVersion,
		"Accept":            "text/event-stream",
	}
	if req.APIKey != "" {
		headers["x-api-key"] = req.APIKey
	}

	// endpoint names which provider/endpoint failed in every error this
	// call returns (docs/goals/0101 slice 2 item 2) -- a companion error
	// must say WHERE the call went, not just what went wrong.
	endpoint := strings.TrimRight(baseURL, "/") + "/v1/messages"
	resp, err := httpconnector.ExecuteStream(httpconnector.Request{
		Method: "POST", URL: endpoint,
		Headers: headers, Body: string(data),
	})
	if err != nil {
		return ChatResult{}, fmt.Errorf("anthropic: request to %s failed: %w", endpoint, err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		errBody, _ := io.ReadAll(resp.Body)
		return ChatResult{}, fmt.Errorf("anthropic: %s returned status %d: %s", endpoint, resp.StatusCode, truncate(string(errBody)))
	}

	var full strings.Builder
	calls := map[int]*buildingToolCall{}
	var order []int
	var streamErr error
	scanErr := scanSSE(resp.Body, func(event, data string) bool {
		d, stop, err := parseAnthropicEvent(event, data)
		if err != nil {
			streamErr = err
			return false
		}
		mergeAnthropicStreamDelta(&full, onDelta, calls, &order, d)
		return !stop
	})
	result := ChatResult{Text: full.String(), ToolCalls: finishToolCalls(calls, order)}
	if scanErr != nil {
		return result, fmt.Errorf("anthropic: %s: read stream: %w", endpoint, scanErr)
	}
	if streamErr != nil {
		return result, fmt.Errorf("anthropic: %s: %w", endpoint, streamErr)
	}
	return result, nil
}
