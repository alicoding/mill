package agentloopsvc

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/alicoding/mill/internal/adapters/aiclient"
	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// The full run() loop, unit-tested here against a minimal, self-
// contained fake MCP server (the real SDK's client/server roles, real
// mcp.NewInMemoryTransports -- just not Mill's own tool set) and a
// scripted chatFn -- proving this package's OWN mechanics (turn
// iteration, tool dispatch, the parked-write pause/resume state
// machine, max-turns/context-size/cancellation bounds) at the layer
// that owns them. The REAL Mill-specific integration (actual
// gateWrite/ResolveMCPWrite semantics, a real Atlas write) is proven
// separately and end-to-end in internal/services/mcpsvc's
// millmcpservice_agentloop*_test.go -- this file never re-derives that,
// it covers the generic loop logic those integration tests exercise
// but (being a different package's test binary) don't count as this
// package's own coverage.

// fakeWritePlane is a tiny, in-memory stand-in for Mill's own
// park-and-poll approval plane (docs/adr/0032) -- NOT a reimplementation
// of gateWrite's real semantics (that stays proven for real in
// mcpsvc), just enough of the same textual/polling CONTRACT
// (parseParkedWriteID's own pattern, check_write_status's status/
// result/error JSON shape) for run()'s pause/resume code to exercise
// against. autoResolveAfter simulates "the human decided" after that
// many polls, deterministically -- no goroutine/timing coordination
// needed from a test.
type fakeWritePlane struct {
	mu               sync.Mutex
	nextID           int
	polls            map[string]int
	autoResolveAfter int
	resolveStatus    string
	resolveResult    string
	resolveError     string
}

func (p *fakeWritePlane) propose() string {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.nextID++
	id := fmt.Sprintf("w%d", p.nextID)
	p.polls[id] = 0
	return id
}

func (p *fakeWritePlane) status(id string) (status, result, errText string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.polls[id]++
	if p.polls[id] < p.autoResolveAfter {
		return "pending", "", ""
	}
	return p.resolveStatus, p.resolveResult, p.resolveError
}

// newFakeMCPServer builds a real *mcp.Server exposing three tools:
// "read_thing" (an ordinary read, never parks), "propose_write" (always
// parks, backed by plane), and "check_write_status" (the SAME polling
// contract name Mill's own server uses, so parseParkedWriteID/
// pollWriteStatus need no test-only branch).
func newFakeMCPServer(plane *fakeWritePlane) *mcp.Server {
	srv := mcp.NewServer(&mcp.Implementation{Name: "fake", Version: "0.0.0"}, nil)
	mcp.AddTool(srv, &mcp.Tool{Name: "read_thing", Description: "reads a thing"},
		func(_ context.Context, _ *mcp.CallToolRequest, _ struct{}) (*mcp.CallToolResult, any, error) {
			return &mcp.CallToolResult{Content: []mcp.Content{&mcp.TextContent{Text: `{"thing":"ok"}`}}}, nil, nil
		})
	mcp.AddTool(srv, &mcp.Tool{Name: "propose_write", Description: "a write that always parks"},
		func(_ context.Context, _ *mcp.CallToolRequest, _ struct{}) (*mcp.CallToolResult, any, error) {
			id := plane.propose()
			text := fmt.Sprintf("parked pending human approval; id=%s; call check_write_status with this id", id)
			return &mcp.CallToolResult{Content: []mcp.Content{&mcp.TextContent{Text: text}}}, nil, nil
		})
	mcp.AddTool(srv, &mcp.Tool{Name: "check_write_status", Description: "poll a parked write"},
		func(_ context.Context, _ *mcp.CallToolRequest, in struct {
			ID string `json:"id"`
		}) (*mcp.CallToolResult, any, error) {
			status, result, errText := plane.status(in.ID)
			data, _ := json.Marshal(checkWriteStatusResult{Status: status, Result: result, Error: errText})
			return &mcp.CallToolResult{Content: []mcp.Content{&mcp.TextContent{Text: string(data)}}}, nil, nil
		})
	return srv
}

// fakeConnector implements MCPConnector against one in-process
// *mcp.Server via real in-memory transports -- the same construction
// MillMCPService.ConnectInMemoryClient uses in production, just against
// a minimal fake server instead of the real Mill one.
type fakeConnector struct{ server *mcp.Server }

func (f *fakeConnector) ConnectInMemoryClient(ctx context.Context, name string) (*mcp.ClientSession, error) {
	clientTransport, serverTransport := mcp.NewInMemoryTransports()
	if _, err := f.server.Connect(ctx, serverTransport, nil); err != nil {
		return nil, err
	}
	client := mcp.NewClient(&mcp.Implementation{Name: name, Version: "0.0.0"}, nil)
	return client.Connect(ctx, clientTransport, nil)
}

// erroringConnector always fails ConnectInMemoryClient -- exercises
// setupRun's own connect-failure branch.
type erroringConnector struct{}

func (erroringConnector) ConnectInMemoryClient(context.Context, string) (*mcp.ClientSession, error) {
	return nil, errors.New("connect failed")
}

// scriptedChat scripts chatFn's return per call, in order -- a call
// past the scripted list is a test bug, reported via the returned
// error rather than a panic.
type scriptedChat struct {
	mu    sync.Mutex
	turns []func(aiclient.ChatRequest) (aiclient.ChatResult, error)
	i     int
}

func (s *scriptedChat) fn(req aiclient.ChatRequest, onDelta func(string)) (aiclient.ChatResult, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.i >= len(s.turns) {
		return aiclient.ChatResult{}, fmt.Errorf("scriptedChat: no more scripted turns (call %d)", s.i+1)
	}
	f := s.turns[s.i]
	s.i++
	onDelta("") // exercise the streaming callback path without asserting its content here
	return f(req)
}

func textTurn(text string) func(aiclient.ChatRequest) (aiclient.ChatResult, error) {
	return func(aiclient.ChatRequest) (aiclient.ChatResult, error) { return aiclient.ChatResult{Text: text}, nil }
}

func toolCallTurn(id, name, argsJSON string) func(aiclient.ChatRequest) (aiclient.ChatResult, error) {
	return func(aiclient.ChatRequest) (aiclient.ChatResult, error) {
		return aiclient.ChatResult{ToolCalls: []aiclient.ToolCall{{ID: id, Name: name, Arguments: json.RawMessage(argsJSON)}}}, nil
	}
}

// withScriptedChat swaps chatFn for the duration of one test -- same-
// package test file, so this reassigns the var directly rather than
// needing an exported setter (unlike writeStatusPollInterval/maxTurns,
// which mcpsvc's cross-package integration tests also need to reach).
func withScriptedChat(t *testing.T, turns ...func(aiclient.ChatRequest) (aiclient.ChatResult, error)) {
	t.Helper()
	sc := &scriptedChat{turns: turns}
	orig := chatFn
	chatFn = sc.fn
	t.Cleanup(func() { chatFn = orig })
}

func stubResolvableProvider(t *testing.T) {
	t.Helper()
	composition.SetAIProviderLookup(func(id string) (composition.ResolvedAIProvider, error) {
		return composition.ResolvedAIProvider{Kind: "openai-compatible", BaseURL: "http://example.invalid", Model: "m"}, nil
	})
	t.Cleanup(func() {
		composition.SetAIProviderLookup(func(id string) (composition.ResolvedAIProvider, error) {
			return composition.ResolvedAIProvider{}, errors.New("no AI provider lookup registered (yet)")
		})
	})
}

func collectEvents(t *testing.T) chan AgentLoopEvent {
	t.Helper()
	ch := make(chan AgentLoopEvent, 64)
	SetStateTestHook(func(e AgentLoopEvent) { ch <- e })
	t.Cleanup(func() { SetStateTestHook(nil) })
	return ch
}

func awaitTerminal(t *testing.T, ch chan AgentLoopEvent) AgentLoopEvent {
	t.Helper()
	deadline := time.After(5 * time.Second)
	for {
		select {
		case e := <-ch:
			switch e.State {
			case StateDone, StateFailed, StateCancelled:
				return e
			}
		case <-deadline:
			t.Fatal("never reached a terminal state within 5s")
		}
	}
}

func TestRun_TwoReadsThenFinalAnswer(t *testing.T) {
	stubResolvableProvider(t)
	withScriptedChat(t,
		toolCallTurn("c1", "read_thing", "{}"),
		toolCallTurn("c2", "read_thing", "{}"),
		textTurn("done reading"),
	)
	plane := &fakeWritePlane{polls: map[string]int{}}
	s := NewAgentLoopService(&fakeConnector{server: newFakeMCPServer(plane)})
	ch := collectEvents(t)

	if _, err := s.StartGoal("p1", "m", "read twice then answer"); err != nil {
		t.Fatalf("StartGoal: %v", err)
	}
	e := awaitTerminal(t, ch)
	if e.State != StateDone || e.Text != "done reading" {
		t.Fatalf("got %+v, want a done event with the final text", e)
	}
}

func TestRun_ParkedWrite_ApprovedResumes(t *testing.T) {
	stubResolvableProvider(t)
	SetWriteStatusPollIntervalForTest(5 * time.Millisecond)
	t.Cleanup(func() { SetWriteStatusPollIntervalForTest(2 * time.Second) })
	withScriptedChat(t,
		toolCallTurn("c1", "propose_write", "{}"),
		textTurn("resumed after approval"),
	)
	plane := &fakeWritePlane{polls: map[string]int{}, autoResolveAfter: 2, resolveStatus: "approved", resolveResult: "created-thing-1"}
	s := NewAgentLoopService(&fakeConnector{server: newFakeMCPServer(plane)})
	ch := collectEvents(t)

	sessionID, err := s.StartGoal("p1", "m", "create a thing")
	if err != nil {
		t.Fatalf("StartGoal: %v", err)
	}

	var sawAwaiting bool
	for {
		e := <-ch
		if e.SessionID != sessionID {
			continue
		}
		if e.State == StateAwaitingApproval {
			sawAwaiting = true
			if e.WriteID == "" {
				t.Error("awaiting-approval event carried no WriteID")
			}
		}
		if e.State == StateDone {
			if !sawAwaiting {
				t.Error("goal completed without ever pausing for approval")
			}
			if e.Text != "resumed after approval" {
				t.Errorf("Text = %q", e.Text)
			}
			return
		}
		if e.State == StateFailed || e.State == StateCancelled {
			t.Fatalf("goal ended in %s: %+v", e.State, e)
		}
	}
}

func TestRun_ParkedWrite_DeniedFeedsRefusalText(t *testing.T) {
	stubResolvableProvider(t)
	SetWriteStatusPollIntervalForTest(5 * time.Millisecond)
	t.Cleanup(func() { SetWriteStatusPollIntervalForTest(2 * time.Second) })
	withScriptedChat(t,
		toolCallTurn("c1", "propose_write", "{}"),
		textTurn("acknowledged the denial"),
	)
	plane := &fakeWritePlane{polls: map[string]int{}, autoResolveAfter: 1, resolveStatus: "denied", resolveError: "no"}
	s := NewAgentLoopService(&fakeConnector{server: newFakeMCPServer(plane)})
	ch := collectEvents(t)

	if _, err := s.StartGoal("p1", "m", "create a thing"); err != nil {
		t.Fatalf("StartGoal: %v", err)
	}
	e := awaitTerminal(t, ch)
	if e.State != StateDone || e.Text != "acknowledged the denial" {
		t.Fatalf("got %+v, want the model's re-plan turn to complete normally", e)
	}
}

func TestRun_MaxTurns_EmitsFailed(t *testing.T) {
	stubResolvableProvider(t)
	SetMaxTurnsForTest(2)
	t.Cleanup(func() { SetMaxTurnsForTest(DefaultMaxTurns) })
	withScriptedChat(t,
		toolCallTurn("c1", "read_thing", "{}"),
		toolCallTurn("c2", "read_thing", "{}"),
		toolCallTurn("c3", "read_thing", "{}"),
	)
	plane := &fakeWritePlane{polls: map[string]int{}}
	s := NewAgentLoopService(&fakeConnector{server: newFakeMCPServer(plane)})
	ch := collectEvents(t)

	if _, err := s.StartGoal("p1", "m", "never converges"); err != nil {
		t.Fatalf("StartGoal: %v", err)
	}
	e := awaitTerminal(t, ch)
	if e.State != StateFailed || !strings.Contains(e.Text, "2-turn limit") {
		t.Fatalf("got %+v, want a failed event naming the turn limit", e)
	}
}

func TestRun_ContextByteCap_EmitsFailed(t *testing.T) {
	stubResolvableProvider(t)
	SetContextByteCapForTest(10)
	t.Cleanup(func() { SetContextByteCapForTest(DefaultContextByteCap) })
	withScriptedChat(t, toolCallTurn("c1", "read_thing", "{}"))
	plane := &fakeWritePlane{polls: map[string]int{}}
	s := NewAgentLoopService(&fakeConnector{server: newFakeMCPServer(plane)})
	ch := collectEvents(t)

	if _, err := s.StartGoal("p1", "m", "this goal text alone is already past the tiny test cap"); err != nil {
		t.Fatalf("StartGoal: %v", err)
	}
	e := awaitTerminal(t, ch)
	if e.State != StateFailed || !strings.Contains(e.Text, "context-size cap") {
		t.Fatalf("got %+v, want a failed event naming the context cap", e)
	}
}

func TestRun_CancelWhilePolling_EmitsCancelled(t *testing.T) {
	stubResolvableProvider(t)
	SetWriteStatusPollIntervalForTest(5 * time.Millisecond)
	t.Cleanup(func() { SetWriteStatusPollIntervalForTest(2 * time.Second) })
	withScriptedChat(t, toolCallTurn("c1", "propose_write", "{}"))
	// autoResolveAfter is never reached -- the write stays pending
	// forever, so only cancellation can end this goal.
	plane := &fakeWritePlane{polls: map[string]int{}, autoResolveAfter: 1 << 30}
	s := NewAgentLoopService(&fakeConnector{server: newFakeMCPServer(plane)})
	ch := collectEvents(t)

	sessionID, err := s.StartGoal("p1", "m", "create a thing nobody approves")
	if err != nil {
		t.Fatalf("StartGoal: %v", err)
	}
	for {
		e := <-ch
		if e.SessionID == sessionID && e.State == StateAwaitingApproval {
			break
		}
	}
	if err := s.CancelGoal(sessionID); err != nil {
		t.Fatalf("CancelGoal: %v", err)
	}
	e := awaitTerminal(t, ch)
	if e.State != StateCancelled {
		t.Fatalf("got %+v, want cancelled", e)
	}
}

func TestRun_ConnectFails_EmitsFailed(t *testing.T) {
	stubResolvableProvider(t)
	s := NewAgentLoopService(erroringConnector{})
	ch := collectEvents(t)

	if _, err := s.StartGoal("p1", "m", "a goal"); err != nil {
		t.Fatalf("StartGoal: %v", err)
	}
	e := awaitTerminal(t, ch)
	if e.State != StateFailed {
		t.Fatalf("got %+v, want failed when the MCP connector errors", e)
	}
}

func TestRun_ChatError_EmitsFailed(t *testing.T) {
	stubResolvableProvider(t)
	withScriptedChat(t, func(aiclient.ChatRequest) (aiclient.ChatResult, error) {
		return aiclient.ChatResult{}, errors.New("provider unreachable")
	})
	plane := &fakeWritePlane{polls: map[string]int{}}
	s := NewAgentLoopService(&fakeConnector{server: newFakeMCPServer(plane)})
	ch := collectEvents(t)

	if _, err := s.StartGoal("p1", "m", "a goal"); err != nil {
		t.Fatalf("StartGoal: %v", err)
	}
	e := awaitTerminal(t, ch)
	if e.State != StateFailed || !strings.Contains(e.Text, "provider unreachable") {
		t.Fatalf("got %+v, want failed naming the chat error", e)
	}
}

func TestRun_BadToolCallArguments_FeedsErrorAsToolResultNotLoopFailure(t *testing.T) {
	stubResolvableProvider(t)
	withScriptedChat(t,
		toolCallTurn("c1", "read_thing", "not valid json"),
		textTurn("recovered from the bad arguments"),
	)
	plane := &fakeWritePlane{polls: map[string]int{}}
	s := NewAgentLoopService(&fakeConnector{server: newFakeMCPServer(plane)})
	ch := collectEvents(t)

	if _, err := s.StartGoal("p1", "m", "a goal"); err != nil {
		t.Fatalf("StartGoal: %v", err)
	}
	e := awaitTerminal(t, ch)
	if e.State != StateDone || e.Text != "recovered from the bad arguments" {
		t.Fatalf("got %+v, want the model to see the argument error and recover, not fail the loop", e)
	}
}
