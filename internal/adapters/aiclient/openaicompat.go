package aiclient

import (
	"encoding/json"
	"fmt"
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

func schemaName(name string) string {
	if name == "" {
		return "result"
	}
	return name
}

// truncate keeps an error message readable when a non-2xx response body
// is large (an HTML error page, a verbose stack trace) -- same
// reasoning as httpconnector callers elsewhere in this codebase never
// echoing an unbounded body straight into an error string.
func truncate(s string) string {
	const max = 500
	if len(s) <= max {
		return s
	}
	return s[:max] + "…"
}
