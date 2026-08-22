package aiclient

import (
	"bufio"
	"fmt"
	"io"
	"strings"
)

// ChatMessage is one turn of a multi-turn conversation -- Role is
// "user" or "assistant", mirroring every wire shape's own vocabulary
// exactly (see chatOpenAICompat/chatAnthropic).
type ChatMessage struct {
	Role    string
	Content string
}

// ChatRequest is one streaming, multi-turn completion call -- the
// companion panel's own request shape (docs/goals/0101-atlas-ai-
// companion.md slice 1), distinct from Request/Complete above because
// a conversation has no Schema concept: the reply contract that makes
// a turn machine-parseable travels inside System instead (the same
// envelope BuildContextEnvelope already produces), never as a second,
// competing structured-output mechanism.
type ChatRequest struct {
	Kind     Kind
	BaseURL  string
	Model    string
	APIKey   string
	System   string
	Messages []ChatMessage
}

// Chat dispatches req to the streaming adapter matching req.Kind,
// invoking onDelta with each incremental text chunk as the provider
// streams its reply -- never buffered, since the companion panel
// renders tokens into the transcript as they arrive. Returns the
// complete, concatenated reply text once the stream ends. A mid-stream
// failure still returns whatever text streamed before it broke,
// alongside the error, so a caller can decide whether a partial reply
// is worth keeping.
func Chat(req ChatRequest, onDelta func(string)) (string, error) {
	switch req.Kind {
	case KindOpenAICompat:
		return chatOpenAICompat(req, onDelta)
	case KindAnthropic:
		return chatAnthropic(req, onDelta)
	default:
		return "", fmt.Errorf("aiclient: unknown provider kind %q", req.Kind)
	}
}

// scanSSE reads a Server-Sent-Events stream (the wire shape both
// OpenAI-compatible and Anthropic streaming APIs use, per their own
// published docs -- verified before building, docs/goals/0101 item 1):
// a run of "field: value" lines terminated by a blank line is one
// event, "data:" lines accumulate (joined by "\n" per the SSE spec)
// and "event:" names it (defaulting to "message" when absent, also
// per spec). onEvent is called once per dispatched event with its
// event name and joined data; returning false stops the scan early
// (a [DONE] sentinel or a terminal event type). Lines starting with
// ":" (SSE comments, used by some providers as keep-alives) and any
// other field (id:, retry:) are ignored -- this adapter only needs
// the two fields above.
func scanSSE(r io.Reader, onEvent func(event, data string) bool) error {
	scanner := bufio.NewScanner(r)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	event := ""
	var dataLines []string
	flush := func() bool {
		if len(dataLines) == 0 {
			return true
		}
		data := strings.Join(dataLines, "\n")
		ev := event
		if ev == "" {
			ev = "message"
		}
		cont := onEvent(ev, data)
		event, dataLines = "", nil
		return cont
	}
	for scanner.Scan() {
		line := scanner.Text()
		switch {
		case line == "":
			if !flush() {
				return nil
			}
		case strings.HasPrefix(line, ":"):
			// comment/keep-alive line -- ignored per spec
		case strings.HasPrefix(line, "event:"):
			event = strings.TrimSpace(strings.TrimPrefix(line, "event:"))
		case strings.HasPrefix(line, "data:"):
			dataLines = append(dataLines, strings.TrimPrefix(strings.TrimPrefix(line, "data:"), " "))
		}
	}
	flush()
	return scanner.Err()
}
