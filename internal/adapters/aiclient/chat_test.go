package aiclient

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// fixtureOpenAICompatStream writes an SSE response built from chunks
// (each wrapped as one "data: {...}\n\n" event), followed by the
// [DONE] sentinel unless the caller already ended the stream on an
// error chunk.
func fixtureOpenAICompatStream(t *testing.T, chunks []string, done bool) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/chat/completions" {
			t.Errorf("unexpected path %q", r.URL.Path)
		}
		w.Header().Set("Content-Type", "text/event-stream")
		flusher, _ := w.(http.Flusher)
		for _, c := range chunks {
			_, _ = w.Write([]byte("data: " + c + "\n\n"))
			if flusher != nil {
				flusher.Flush()
			}
		}
		if done {
			_, _ = w.Write([]byte("data: [DONE]\n\n"))
		}
	}))
	t.Cleanup(srv.Close)
	return srv
}

func TestChatOpenAICompat_StreamsDeltasAndReturnsFullText(t *testing.T) {
	srv := fixtureOpenAICompatStream(t, []string{
		`{"choices":[{"delta":{"content":"hel"}}]}`,
		`{"choices":[{"delta":{"content":"lo"}}]}`,
	}, true)
	var deltas []string
	res, err := Chat(ChatRequest{
		Kind: KindOpenAICompat, BaseURL: srv.URL, Model: "llama3.2",
		System: "be terse", Messages: []ChatMessage{{Role: "user", Content: "say hi"}},
	}, func(d string) { deltas = append(deltas, d) })
	if err != nil {
		t.Fatalf("Chat: %v", err)
	}
	if res.Text != "hello" {
		t.Errorf("text = %q, want %q", res.Text, "hello")
	}
	if len(deltas) != 2 || deltas[0] != "hel" || deltas[1] != "lo" {
		t.Errorf("deltas = %v, want [hel lo]", deltas)
	}
}

func TestChatOpenAICompat_MidStreamErrorReturnsPartialTextAndError(t *testing.T) {
	srv := fixtureOpenAICompatStream(t, []string{
		`{"choices":[{"delta":{"content":"partial"}}]}`,
		`{"error":{"message":"model overloaded"}}`,
	}, false)
	res, err := Chat(ChatRequest{
		Kind: KindOpenAICompat, BaseURL: srv.URL, Model: "llama3.2",
		Messages: []ChatMessage{{Role: "user", Content: "hi"}},
	}, func(string) {})
	if err == nil || !strings.Contains(err.Error(), "model overloaded") {
		t.Fatalf("expected an error mentioning the mid-stream failure, got: %v", err)
	}
	if res.Text != "partial" {
		t.Errorf("text = %q, want the text streamed before the failure %q", res.Text, "partial")
	}
}

func TestChatOpenAICompat_NonSuccessStatus(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"error":"invalid api key"}`))
	}))
	t.Cleanup(srv.Close)
	_, err := Chat(ChatRequest{Kind: KindOpenAICompat, BaseURL: srv.URL, Model: "m", Messages: []ChatMessage{{Role: "user", Content: "x"}}}, func(string) {})
	if err == nil || !strings.Contains(err.Error(), "401") {
		t.Fatalf("expected an error mentioning the 401 status, got: %v", err)
	}
}

func TestChatOpenAICompat_SendsFullMessageHistoryAndSystem(t *testing.T) {
	var gotBody string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		buf := make([]byte, 4096)
		n, _ := r.Body.Read(buf)
		gotBody = string(buf[:n])
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = w.Write([]byte(`data: {"choices":[{"delta":{"content":"ok"}}]}` + "\n\n" + "data: [DONE]\n\n"))
	}))
	t.Cleanup(srv.Close)
	_, err := Chat(ChatRequest{
		Kind: KindOpenAICompat, BaseURL: srv.URL, Model: "m", System: "sys",
		Messages: []ChatMessage{{Role: "user", Content: "first"}, {Role: "assistant", Content: "reply"}, {Role: "user", Content: "second"}},
	}, func(string) {})
	if err != nil {
		t.Fatalf("Chat: %v", err)
	}
	for _, want := range []string{`"sys"`, `"first"`, `"reply"`, `"second"`, `"stream":true`} {
		if !strings.Contains(gotBody, want) {
			t.Errorf("request body %s does not contain %s", gotBody, want)
		}
	}
}

// fixtureAnthropicStream writes an Anthropic-shaped SSE stream: each
// (event, data) pair as "event: X\ndata: Y\n\n".
func fixtureAnthropicStream(t *testing.T, events [][2]string) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/messages" {
			t.Errorf("unexpected path %q", r.URL.Path)
		}
		w.Header().Set("Content-Type", "text/event-stream")
		flusher, _ := w.(http.Flusher)
		for _, ev := range events {
			_, _ = w.Write([]byte("event: " + ev[0] + "\ndata: " + ev[1] + "\n\n"))
			if flusher != nil {
				flusher.Flush()
			}
		}
	}))
	t.Cleanup(srv.Close)
	return srv
}

func TestChatAnthropic_StreamsTextDeltasAndReturnsFullText(t *testing.T) {
	srv := fixtureAnthropicStream(t, [][2]string{
		{"message_start", `{"type":"message_start"}`},
		{"content_block_delta", `{"delta":{"type":"text_delta","text":"hel"}}`},
		{"content_block_delta", `{"delta":{"type":"text_delta","text":"lo"}}`},
		{"message_stop", `{"type":"message_stop"}`},
	})
	var deltas []string
	res, err := Chat(ChatRequest{
		Kind: KindAnthropic, BaseURL: srv.URL, Model: "claude-sonnet-4-5",
		Messages: []ChatMessage{{Role: "user", Content: "hi"}},
	}, func(d string) { deltas = append(deltas, d) })
	if err != nil {
		t.Fatalf("Chat: %v", err)
	}
	if res.Text != "hello" {
		t.Errorf("text = %q, want %q", res.Text, "hello")
	}
	if len(deltas) != 2 {
		t.Errorf("deltas = %v, want 2 entries", deltas)
	}
}

func TestChatAnthropic_ErrorEventReturnsPartialTextAndError(t *testing.T) {
	srv := fixtureAnthropicStream(t, [][2]string{
		{"content_block_delta", `{"delta":{"type":"text_delta","text":"partial"}}`},
		{"error", `{"type":"error","error":{"type":"overloaded_error","message":"overloaded"}}`},
	})
	res, err := Chat(ChatRequest{
		Kind: KindAnthropic, BaseURL: srv.URL, Model: "claude-sonnet-4-5",
		Messages: []ChatMessage{{Role: "user", Content: "hi"}},
	}, func(string) {})
	if err == nil || !strings.Contains(err.Error(), "overloaded") {
		t.Fatalf("expected an error mentioning the failure, got: %v", err)
	}
	if res.Text != "partial" {
		t.Errorf("text = %q, want %q", res.Text, "partial")
	}
}

// fixtureOpenAICompatCapture serves one minimal successful streaming
// reply while capturing the raw request body into *gotBody -- shared by
// chat_tools_test.go's request-shape assertions (tool defs reaching the
// wire, a tool-result turn's own shape) that only care what was SENT,
// not what streams back.
func fixtureOpenAICompatCapture(t *testing.T, gotBody *string) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		buf := make([]byte, 8192)
		n, _ := r.Body.Read(buf)
		*gotBody = string(buf[:n])
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = w.Write([]byte(`data: {"choices":[{"delta":{"content":"ok"}}]}` + "\n\n" + "data: [DONE]\n\n"))
	}))
	t.Cleanup(srv.Close)
	return srv
}

// fixtureAnthropicCapture mirrors fixtureOpenAICompatCapture for the
// Anthropic wire shape.
func fixtureAnthropicCapture(t *testing.T, gotBody *string) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		buf := make([]byte, 8192)
		n, _ := r.Body.Read(buf)
		*gotBody = string(buf[:n])
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = w.Write([]byte("event: content_block_delta\ndata: {\"delta\":{\"type\":\"text_delta\",\"text\":\"ok\"}}\n\n" +
			"event: message_stop\ndata: {\"type\":\"message_stop\"}\n\n"))
	}))
	t.Cleanup(srv.Close)
	return srv
}

func TestChat_UnknownKindErrors(t *testing.T) {
	_, err := Chat(ChatRequest{Kind: Kind("bogus")}, func(string) {})
	if err == nil {
		t.Fatal("expected an error for an unknown provider kind")
	}
}
