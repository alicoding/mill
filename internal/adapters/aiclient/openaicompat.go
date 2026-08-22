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
// turn in order -- split out purely to keep chatOpenAICompat's own
// cognitive complexity under the repo's gate.
func openAICompatChatMessages(req ChatRequest) []map[string]string {
	messages := []map[string]string{}
	if req.System != "" {
		messages = append(messages, map[string]string{"role": "system", "content": req.System})
	}
	for _, m := range req.Messages {
		messages = append(messages, map[string]string{"role": m.Role, "content": m.Content})
	}
	return messages
}

// openAICompatChunk is one decoded streaming chunk's shape.
type openAICompatChunk struct {
	Choices []struct {
		Delta struct {
			Content string `json:"content"`
		} `json:"delta"`
	} `json:"choices"`
	Error *struct {
		Message string `json:"message"`
	} `json:"error"`
}

// parseOpenAICompatChunk decodes one SSE data payload into its text
// delta (empty when the chunk carries none) -- split out of
// chatOpenAICompat's scanSSE closure purely to keep that function's
// own cognitive complexity under the repo's gate. done reports the
// [DONE] sentinel; err reports a decode failure or an in-band error
// chunk. Returned unprefixed -- chatOpenAICompat wraps it with the
// provider/endpoint that failed at its own return site, the one place
// that prefix gets added.
func parseOpenAICompatChunk(data string) (delta string, done bool, err error) {
	if strings.TrimSpace(data) == "[DONE]" {
		return "", true, nil
	}
	var chunk openAICompatChunk
	if err := json.Unmarshal([]byte(data), &chunk); err != nil {
		return "", false, fmt.Errorf("parse stream chunk: %w", err)
	}
	if chunk.Error != nil {
		return "", false, errors.New(chunk.Error.Message)
	}
	for _, c := range chunk.Choices {
		if c.Delta.Content != "" {
			delta += c.Delta.Content
		}
	}
	return delta, false, nil
}

func chatOpenAICompat(req ChatRequest, onDelta func(string)) (string, error) {
	body := map[string]any{"model": req.Model, "messages": openAICompatChatMessages(req), "stream": true}
	data, err := json.Marshal(body)
	if err != nil {
		return "", fmt.Errorf("openai-compatible: encode request: %w", err)
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
		return "", fmt.Errorf("openai-compatible: request to %s failed: %w", endpoint, err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		errBody, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("openai-compatible: %s returned status %d: %s", endpoint, resp.StatusCode, truncate(string(errBody)))
	}

	var full strings.Builder
	var streamErr error
	scanErr := scanSSE(resp.Body, func(_, data string) bool {
		delta, done, err := parseOpenAICompatChunk(data)
		if err != nil {
			streamErr = err
			return false
		}
		if delta != "" {
			full.WriteString(delta)
			onDelta(delta)
		}
		return !done
	})
	if scanErr != nil {
		return full.String(), fmt.Errorf("openai-compatible: %s: read stream: %w", endpoint, scanErr)
	}
	if streamErr != nil {
		return full.String(), fmt.Errorf("openai-compatible: %s: %w", endpoint, streamErr)
	}
	return full.String(), nil
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
