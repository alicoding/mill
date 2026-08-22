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
// (only delta.type == "text_delta" carries prose; a tool-use delta
// shape doesn't apply here, this call never requests structured
// output), an error event carries a terminal failure, and message_stop
// ends the stream.
// anthropicChatMessages converts a chat conversation's turns into the
// Messages API's own role/content shape.
func anthropicChatMessages(turns []ChatMessage) []map[string]string {
	messages := make([]map[string]string, 0, len(turns))
	for _, m := range turns {
		messages = append(messages, map[string]string{"role": m.Role, "content": m.Content})
	}
	return messages
}

// parseAnthropicEvent decodes one Anthropic SSE (event, data) pair
// into its text delta -- split out of chatAnthropic's scanSSE closure
// purely to keep that function's own cognitive complexity under the
// repo's gate. stop reports message_stop (or any decode/error-event
// failure, carried in err); every other event contributes no delta.
// Returned unprefixed -- chatAnthropic wraps it with the provider/
// endpoint that failed at its own return site, the one place that
// prefix gets added.
func parseAnthropicEvent(event, data string) (delta string, stop bool, err error) {
	switch event {
	case "content_block_delta":
		var d struct {
			Delta struct {
				Type string `json:"type"`
				Text string `json:"text"`
			} `json:"delta"`
		}
		if err := json.Unmarshal([]byte(data), &d); err != nil {
			return "", true, fmt.Errorf("parse stream event: %w", err)
		}
		if d.Delta.Type == "text_delta" {
			return d.Delta.Text, false, nil
		}
		return "", false, nil
	case "error":
		var e struct {
			Error struct {
				Message string `json:"message"`
			} `json:"error"`
		}
		_ = json.Unmarshal([]byte(data), &e)
		return "", true, errors.New(e.Error.Message)
	case "message_stop":
		return "", true, nil
	default:
		return "", false, nil
	}
}

func chatAnthropic(req ChatRequest, onDelta func(string)) (string, error) {
	baseURL := effectiveAnthropicBaseURL(req.BaseURL)
	body := map[string]any{
		"model": req.Model, "max_tokens": 4096, "messages": anthropicChatMessages(req.Messages), "stream": true,
	}
	if req.System != "" {
		body["system"] = req.System
	}
	data, err := json.Marshal(body)
	if err != nil {
		return "", fmt.Errorf("anthropic: encode request: %w", err)
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
		return "", fmt.Errorf("anthropic: request to %s failed: %w", endpoint, err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		errBody, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("anthropic: %s returned status %d: %s", endpoint, resp.StatusCode, truncate(string(errBody)))
	}

	var full strings.Builder
	var streamErr error
	scanErr := scanSSE(resp.Body, func(event, data string) bool {
		delta, stop, err := parseAnthropicEvent(event, data)
		if err != nil {
			streamErr = err
			return false
		}
		if delta != "" {
			full.WriteString(delta)
			onDelta(delta)
		}
		return !stop
	})
	if scanErr != nil {
		return full.String(), fmt.Errorf("anthropic: %s: read stream: %w", endpoint, scanErr)
	}
	if streamErr != nil {
		return full.String(), fmt.Errorf("anthropic: %s: %w", endpoint, streamErr)
	}
	return full.String(), nil
}
