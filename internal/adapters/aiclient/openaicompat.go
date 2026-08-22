package aiclient

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"

	"github.com/alicoding/mill/internal/adapters/httpconnector"
)

// completeOpenAICompat speaks the OpenAI-compatible /v1/chat/completions
// shape -- Ollama's own documented OpenAI compatibility layer, and the
// same shape LM Studio/vLLM/any BYO endpoint (including OpenAI itself)
// implements, verified directly against Ollama's docs before building
// (docs/goals/0031 item 1): structured output is requested via the
// standard OpenAI response_format.json_schema envelope, which Ollama's
// own /v1 endpoint accepts when driven through an OpenAI client
// library -- not Ollama's separate NATIVE /api/chat "format" field
// (a bare JSON Schema object, a different shape entirely), which this
// adapter deliberately does not speak: every real target (Ollama's
// /v1, LM Studio, vLLM, OpenAI) shares the one wire shape below, so a
// second code path for Ollama's native API would be an unused surface.
func completeOpenAICompat(req Request) (Result, error) {
	messages := []map[string]string{}
	if req.System != "" {
		messages = append(messages, map[string]string{"role": "system", "content": req.System})
	}
	messages = append(messages, map[string]string{"role": "user", "content": req.Prompt})

	body := map[string]any{
		"model":    req.Model,
		"messages": messages,
	}
	if req.Schema != nil {
		body["response_format"] = map[string]any{
			"type": "json_schema",
			"json_schema": map[string]any{
				"name":   schemaName(req.Schema.Name),
				"schema": json.RawMessage(req.Schema.Schema),
				"strict": true,
			},
		}
	}
	data, err := json.Marshal(body)
	if err != nil {
		return Result{}, fmt.Errorf("openai-compatible: encode request: %w", err)
	}

	headers := map[string]string{"Content-Type": "application/json"}
	if req.APIKey != "" {
		headers["Authorization"] = "Bearer " + req.APIKey
	}

	resp, err := httpconnector.Execute(httpconnector.Request{
		Method: "POST", URL: strings.TrimRight(req.BaseURL, "/") + "/v1/chat/completions",
		Headers: headers, Body: string(data),
	})
	if err != nil {
		return Result{}, fmt.Errorf("openai-compatible: %w", err)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return Result{}, fmt.Errorf("openai-compatible: unexpected status %d: %s", resp.StatusCode, truncate(resp.Body))
	}

	var parsed struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.Unmarshal([]byte(resp.Body), &parsed); err != nil {
		return Result{}, fmt.Errorf("openai-compatible: parse response: %w", err)
	}
	if len(parsed.Choices) == 0 {
		return Result{}, fmt.Errorf("openai-compatible: response had no choices")
	}
	text := parsed.Choices[0].Message.Content

	result := Result{Text: text}
	if req.Schema != nil {
		if !json.Valid([]byte(text)) {
			return Result{}, fmt.Errorf("openai-compatible: expected structured JSON output, got non-JSON content")
		}
		result.JSON = []byte(text)
	}
	return result, nil
}

// chatOpenAICompat speaks the same /v1/chat/completions shape as
// completeOpenAICompat above, with "stream": true -- the documented
// OpenAI-compatible SSE streaming shape (Ollama's /v1 shim included,
// docs/goals/0101 item 1): each event's data is one chunk object whose
// choices[].delta.content is the next text fragment, terminated by a
// literal "data: [DONE]" line rather than a typed final event.
// openAICompatChatMessages builds the messages array chatOpenAICompat
// sends: an optional leading system message, then every conversation
// turn in order, widened to []map[string]any (from plain string values)
// so an assistant turn's tool_calls array and a tool turn's own shape
// both fit -- split out purely to keep chatOpenAICompat's own cognitive
// complexity under the repo's gate.
func openAICompatChatMessages(req ChatRequest) []map[string]any {
	messages := []map[string]any{}
	if req.System != "" {
		messages = append(messages, map[string]any{"role": "system", "content": req.System})
	}
	for _, m := range req.Messages {
		messages = append(messages, openAICompatOneMessage(m))
	}
	return messages
}

// openAICompatOneMessage renders a single ChatMessage in the wire
// shape's own per-role vocabulary -- split out of
// openAICompatChatMessages purely to keep that function's own
// cognitive complexity under the repo's gate. An assistant turn
// carrying ToolCalls sends them as OpenAI's own tool_calls array
// (arguments re-serialized to a JSON string, the wire shape's own
// convention -- distinct from the object-shaped input_schema); a "tool"
// turn sends tool_call_id + content, the correlation OpenAI's API
// requires to match a result back to its call.
func openAICompatOneMessage(m ChatMessage) map[string]any {
	switch {
	case m.Role == "assistant" && len(m.ToolCalls) > 0:
		calls := make([]map[string]any, 0, len(m.ToolCalls))
		for _, tc := range m.ToolCalls {
			calls = append(calls, map[string]any{
				"id": tc.ID, "type": "function",
				"function": map[string]any{"name": tc.Name, "arguments": string(tc.Arguments)},
			})
		}
		msg := map[string]any{"role": "assistant", "tool_calls": calls}
		if m.Content != "" {
			msg["content"] = m.Content
		}
		return msg
	case m.Role == "tool":
		return map[string]any{"role": "tool", "tool_call_id": m.ToolCallID, "content": m.Content}
	default:
		return map[string]any{"role": m.Role, "content": m.Content}
	}
}

// openAICompatToolDefs renders ChatRequest.Tools as OpenAI's own
// tools array shape -- nil (so the "tools" key is omitted entirely,
// some providers reject an empty array) when the caller passed none.
func openAICompatToolDefs(tools []ToolDef) []map[string]any {
	if len(tools) == 0 {
		return nil
	}
	out := make([]map[string]any, 0, len(tools))
	for _, t := range tools {
		out = append(out, map[string]any{
			"type": "function",
			"function": map[string]any{
				"name": t.Name, "description": t.Description,
				"parameters": json.RawMessage(t.InputSchema),
			},
		})
	}
	return out
}

// openAICompatToolCallDelta is one streamed fragment of one tool call
// -- Index identifies which call (a turn may stream several in
// parallel, interleaved by index); ID/Function.Name arrive once, on
// the fragment that starts the call, and Function.Arguments streams
// incrementally across every subsequent fragment for that index.
type openAICompatToolCallDelta struct {
	Index    int    `json:"index"`
	ID       string `json:"id"`
	Function struct {
		Name      string `json:"name"`
		Arguments string `json:"arguments"`
	} `json:"function"`
}

// openAICompatChunk is one decoded streaming chunk's shape.
type openAICompatChunk struct {
	Choices []struct {
		Delta struct {
			Content   string                      `json:"content"`
			ToolCalls []openAICompatToolCallDelta `json:"tool_calls"`
		} `json:"delta"`
	} `json:"choices"`
	Error *struct {
		Message string `json:"message"`
	} `json:"error"`
}

// openAICompatStreamDelta is one decoded chunk's contribution to the
// turn in progress -- the richer replacement for the old bare
// text-only return, now that a chunk may carry tool-call fragments
// instead of (or alongside) text.
type openAICompatStreamDelta struct {
	Text           string
	ToolCallDeltas []openAICompatToolCallDelta
}

// parseOpenAICompatChunk decodes one SSE data payload into its
// contribution to the turn (empty when the chunk carries none) --
// split out of chatOpenAICompat's scanSSE closure purely to keep that
// function's own cognitive complexity under the repo's gate. done
// reports the [DONE] sentinel; err reports a decode failure or an
// in-band error chunk. Returned unprefixed -- chatOpenAICompat wraps it
// with the provider/endpoint that failed at its own return site, the
// one place that prefix gets added.
func parseOpenAICompatChunk(data string) (delta openAICompatStreamDelta, done bool, err error) {
	if strings.TrimSpace(data) == "[DONE]" {
		return openAICompatStreamDelta{}, true, nil
	}
	var chunk openAICompatChunk
	if err := json.Unmarshal([]byte(data), &chunk); err != nil {
		return openAICompatStreamDelta{}, false, fmt.Errorf("parse stream chunk: %w", err)
	}
	if chunk.Error != nil {
		return openAICompatStreamDelta{}, false, errors.New(chunk.Error.Message)
	}
	var out openAICompatStreamDelta
	for _, c := range chunk.Choices {
		if c.Delta.Content != "" {
			out.Text += c.Delta.Content
		}
		out.ToolCallDeltas = append(out.ToolCallDeltas, c.Delta.ToolCalls...)
	}
	return out, false, nil
}

// mergeOpenAICompatToolCallDelta folds one streamed tool-call fragment
// into the in-progress calls map, appending order the first time an
// index appears -- split out of chatOpenAICompat purely to keep that
// function's own cognitive complexity under the repo's gate.
func mergeOpenAICompatToolCallDelta(calls map[int]*buildingToolCall, order *[]int, d openAICompatToolCallDelta) {
	bc, ok := calls[d.Index]
	if !ok {
		bc = &buildingToolCall{}
		calls[d.Index] = bc
		*order = append(*order, d.Index)
	}
	if d.ID != "" {
		bc.id = d.ID
	}
	if d.Function.Name != "" {
		bc.name = d.Function.Name
	}
	bc.args.WriteString(d.Function.Arguments)
}

func chatOpenAICompat(req ChatRequest, onDelta func(string)) (ChatResult, error) {
	body := map[string]any{"model": req.Model, "messages": openAICompatChatMessages(req), "stream": true}
	if defs := openAICompatToolDefs(req.Tools); defs != nil {
		body["tools"] = defs
	}
	data, err := json.Marshal(body)
	if err != nil {
		return ChatResult{}, fmt.Errorf("openai-compatible: encode request: %w", err)
	}

	headers := map[string]string{"Content-Type": "application/json", "Accept": "text/event-stream"}
	if req.APIKey != "" {
		headers["Authorization"] = "Bearer " + req.APIKey
	}

	// endpoint names which provider/endpoint failed in every error this
	// call returns (docs/goals/0101 slice 2 item 2) -- a companion error
	// must say WHERE the call went, not just what went wrong.
	endpoint := strings.TrimRight(req.BaseURL, "/") + "/v1/chat/completions"
	resp, err := httpconnector.ExecuteStream(httpconnector.Request{
		Method: "POST", URL: endpoint,
		Headers: headers, Body: string(data),
	})
	if err != nil {
		return ChatResult{}, fmt.Errorf("openai-compatible: request to %s failed: %w", endpoint, err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		errBody, _ := io.ReadAll(resp.Body)
		return ChatResult{}, fmt.Errorf("openai-compatible: %s returned status %d: %s", endpoint, resp.StatusCode, truncate(string(errBody)))
	}

	var full strings.Builder
	calls := map[int]*buildingToolCall{}
	var order []int
	var streamErr error
	scanErr := scanSSE(resp.Body, func(_, data string) bool {
		d, done, err := parseOpenAICompatChunk(data)
		if err != nil {
			streamErr = err
			return false
		}
		if d.Text != "" {
			full.WriteString(d.Text)
			onDelta(d.Text)
		}
		for _, tcd := range d.ToolCallDeltas {
			mergeOpenAICompatToolCallDelta(calls, &order, tcd)
		}
		return !done
	})
	result := ChatResult{Text: full.String(), ToolCalls: finishToolCalls(calls, order)}
	if scanErr != nil {
		return result, fmt.Errorf("openai-compatible: %s: read stream: %w", endpoint, scanErr)
	}
	if streamErr != nil {
		return result, fmt.Errorf("openai-compatible: %s: %w", endpoint, streamErr)
	}
	return result, nil
}

func schemaName(name string) string {
	if name == "" {
		return "result"
	}
	return name
}

// truncate keeps an error message readable when a non-2xx response body
// is large (an HTML error page, a verbose stack trace) -- capped in the
// low single-digit KBs so a real provider error body (Ollama/OpenAI-
// shaped JSON, typically well under 1KB) always reaches the caller
// whole, while an unbounded body still can't grow an error string
// without limit -- same reasoning as httpconnector callers elsewhere in
// this codebase never echoing an unbounded body straight into an error
// string.
func truncate(s string) string {
	const max = 4096
	if len(s) <= max {
		return s
	}
	return s[:max] + "…"
}
