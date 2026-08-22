package agentloopsvc

import (
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/alicoding/mill/internal/adapters/aiclient"
	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// TestEmitState_PinsExactRegisteredType / TestEmitDelta_PinsExactRegisteredType
// prove the two emit helpers always construct and pass the SAME named
// struct type main.go registers under StateEventName/DeltaEventName --
// the RegisterEvent[T] mismatch-drop gotcha (companionsvc's own
// project-memory precedent: "emit exact registered type, check
// payload-type first when a subscriber never fires") means a future
// edit that swaps in a different type, or a zero-value stand-in, would
// silently drop every event under that name with no compile error
// (Emit's own signature takes `any`). This can't reach into main.go's
// process-global RegisterEvent state from a package test, so it pins
// the other half of the contract instead: exactly what this package's
// own emit call sites construct.
func TestEmitState_PinsExactRegisteredType(t *testing.T) {
	var got AgentLoopEvent
	SetStateTestHook(func(e AgentLoopEvent) { got = e })
	t.Cleanup(func() { SetStateTestHook(nil) })

	emitState("s1", StateCallingTool, "atlas_list_kinds", "write-1", "final text")
	want := AgentLoopEvent{SessionID: "s1", State: StateCallingTool, ToolName: "atlas_list_kinds", WriteID: "write-1", Text: "final text"}
	if got != want {
		t.Errorf("emitState hook received %+v, want %+v", got, want)
	}
}

func TestEmitDelta_PinsExactRegisteredType(t *testing.T) {
	var got AgentLoopDelta
	SetDeltaTestHook(func(d AgentLoopDelta) { got = d })
	t.Cleanup(func() { SetDeltaTestHook(nil) })

	emitDelta("s1", "hel")
	want := AgentLoopDelta{SessionID: "s1", Text: "hel"}
	if got != want {
		t.Errorf("emitDelta hook received %+v, want %+v", got, want)
	}
}

func TestParseParkedWriteID_MatchesGateWriteText(t *testing.T) {
	id, ok := parseParkedWriteID("parked pending human approval; id=abc-123; call check_write_status with this id")
	if !ok || id != "abc-123" {
		t.Errorf("parseParkedWriteID = (%q, %v), want (abc-123, true)", id, ok)
	}
}

func TestParseParkedWriteID_OrdinaryResultNeverMatches(t *testing.T) {
	if _, ok := parseParkedWriteID(`{"kinds":[{"id":"Topic"}]}`); ok {
		t.Error("an ordinary tool result must never be mistaken for a parked write")
	}
}

func TestTranscriptBytes_SumsContentAndToolCallArguments(t *testing.T) {
	messages := []aiclient.ChatMessage{
		{Role: "user", Content: "1234"},
		{Role: "assistant", ToolCalls: []aiclient.ToolCall{{Name: "ab", Arguments: json.RawMessage(`{}`)}}},
	}
	got := transcriptBytes(messages)
	want := len("1234") + len("ab") + len(`{}`)
	if got != want {
		t.Errorf("transcriptBytes = %d, want %d", got, want)
	}
}

func TestBuildToolDefs_ConvertsNameDescriptionAndSchema(t *testing.T) {
	tools := []*mcp.Tool{
		{Name: "atlas_list_kinds", Description: "list kinds", InputSchema: map[string]any{"type": "object"}},
	}
	defs, err := buildToolDefs(tools)
	if err != nil {
		t.Fatalf("buildToolDefs: %v", err)
	}
	if len(defs) != 1 || defs[0].Name != "atlas_list_kinds" || defs[0].Description != "list kinds" {
		t.Fatalf("defs = %+v", defs)
	}
	if !json.Valid(defs[0].InputSchema) {
		t.Errorf("InputSchema is not valid JSON: %s", defs[0].InputSchema)
	}
}

func TestStartGoal_NoProviderSelected_Errors(t *testing.T) {
	s := NewAgentLoopService(nil)
	if _, err := s.StartGoal("", "m", "do something"); err == nil {
		t.Fatal("expected an error when no AI provider is selected")
	}
}

func TestStartGoal_EmptyGoal_Errors(t *testing.T) {
	s := NewAgentLoopService(nil)
	if _, err := s.StartGoal("p1", "m", "   "); err == nil {
		t.Fatal("expected an error for a blank goal")
	}
}

func TestCancelGoal_UnknownSession_Errors(t *testing.T) {
	s := NewAgentLoopService(nil)
	if err := s.CancelGoal("does-not-exist"); err == nil {
		t.Fatal("expected an error cancelling an unknown session")
	}
}

func TestStartGoal_UnresolvableProvider_EmitsFailed(t *testing.T) {
	composition.SetAIProviderLookup(func(id string) (composition.ResolvedAIProvider, error) {
		return composition.ResolvedAIProvider{}, errors.New("no such provider")
	})
	t.Cleanup(func() {
		composition.SetAIProviderLookup(func(id string) (composition.ResolvedAIProvider, error) {
			return composition.ResolvedAIProvider{}, errors.New("no AI provider lookup registered (yet)")
		})
	})

	events := make(chan AgentLoopEvent, 8)
	SetStateTestHook(func(e AgentLoopEvent) { events <- e })
	t.Cleanup(func() { SetStateTestHook(nil) })

	s := NewAgentLoopService(nil)
	sessionID, err := s.StartGoal("does-not-exist", "m", "do something")
	if err != nil {
		t.Fatalf("StartGoal: %v", err)
	}

	evt := <-events
	if evt.SessionID != sessionID || evt.State != StateFailed {
		t.Fatalf("got %+v, want a failed event for session %q", evt, sessionID)
	}
	// The session must be torn down once its loop reaches a terminal
	// state (agentloopservice.go's endSession, called from run()'s own
	// defer -- which fires just after, not before, the failed event
	// above) -- cancelling it must eventually report "no running
	// session", not silently succeed. Polled rather than asserted
	// immediately: endSession runs on run()'s own goroutine, a beat
	// after emitState's hook call returns on this one.
	deadline := time.Now().Add(2 * time.Second)
	for {
		if err := s.CancelGoal(sessionID); err != nil {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("session was never torn down after reaching a terminal state")
		}
		time.Sleep(2 * time.Millisecond)
	}
}
