package mcpsvc

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/alicoding/mill/internal/services/agentloopsvc"
	"github.com/alicoding/mill/internal/services/atlassvc"
	"github.com/alicoding/mill/internal/services/compositionsvc"
	"github.com/alicoding/mill/internal/services/configuresvc"
	"github.com/alicoding/mill/internal/services/servicetest"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// agentloopsvc's own real-plane proof (goal 0101 slice 1): the agent
// loop is architecturally an MCP CLIENT of MillMCPService
// (ConnectInMemoryClient, millmcpservice.go), so its pause/resume
// behavior against a REAL parked write can only be proven here, at the
// seam between the two packages -- agentloopsvc's own tests
// (agentloopservice_test.go) cover pure loop logic that needs no real
// MCP plane; everything below drives a REAL MillMCPService + REAL
// AgentLoopService, no mocks, per the brief's own "no mocks of Mill's
// own server" requirement. mcpWriteCourtesyWindow is shrunk the same
// way millmcpservice_approval_test.go's own tests already do -- this
// file is a plain _test.go inside package mcpsvc, so that's an
// established in-package pattern, not a new one.

// agentloopHarness wires a real MillMCPService (with a real
// AtlasService, seeded so atlas_list_kinds/atlas_search_cards have
// real data) and a real AgentLoopService connected to it via
// ConnectInMemoryClient -- no HTTP listener needed at all, since
// in-memory transports never touch the network.
type agentloopHarness struct {
	store *servicetest.FakeStore
	atlas *atlassvc.AtlasService
	svc   *MillMCPService
	loop  *agentloopsvc.AgentLoopService
}

func newAgentloopHarness(t *testing.T) *agentloopHarness {
	t.Helper()
	store := servicetest.NewFakeStore()
	comp := compositionsvc.NewCompositionService(store)
	cfg := configuresvc.NewConfigureService(store, comp, servicetest.FakeCredentialStore{})
	atlasSvc := atlassvc.NewAtlasService(store)

	svc := NewMillMCPService("0.0.0-test", comp, cfg, store, nil)
	svc.SetAtlasService(atlasSvc)

	return &agentloopHarness{store: store, atlas: atlasSvc, svc: svc, loop: agentloopsvc.NewAgentLoopService(svc)}
}

func (h *agentloopHarness) enableWrites(t *testing.T) {
	t.Helper()
	if err := h.store.Set(MCPWriteEnabledKey, "true"); err != nil {
		t.Fatalf("enable MCP writes: %v", err)
	}
}

// topicKindID resolves the seeded "Topic" kind's id -- the one Kind
// every scenario below writes a test card against; hardcoded to that
// one label (rather than taking a parameter) since nothing here needs
// a second Kind yet.
func (h *agentloopHarness) topicKindID(t *testing.T) string {
	t.Helper()
	for _, k := range h.atlas.Kinds() {
		if k.Label == "Topic" {
			return k.ID
		}
	}
	t.Fatal("no seeded kind labeled \"Topic\"")
	return ""
}

// wireProvider points composition's process-global AI-provider lookup
// at srv for providerID "test-provider" -- the same seam
// companionsvc's own tests use (composition.SetAIProviderLookup),
// restored via t.Cleanup so it never leaks into another test.
func (h *agentloopHarness) wireProvider(t *testing.T, srv *httptest.Server) {
	t.Helper()
	composition.SetAIProviderLookup(func(id string) (composition.ResolvedAIProvider, error) {
		return composition.ResolvedAIProvider{Kind: "openai-compatible", BaseURL: srv.URL, Model: "m"}, nil
	})
	t.Cleanup(func() {
		composition.SetAIProviderLookup(func(id string) (composition.ResolvedAIProvider, error) {
			return composition.ResolvedAIProvider{}, errors.New("no AI provider lookup registered (yet)")
		})
	})
}

// events collects every AgentLoopEvent a goal emits onto a buffered
// channel via SetStateTestHook -- reset via t.Cleanup.
func (h *agentloopHarness) events(t *testing.T) chan agentloopsvc.AgentLoopEvent {
	t.Helper()
	ch := make(chan agentloopsvc.AgentLoopEvent, 64)
	agentloopsvc.SetStateTestHook(func(e agentloopsvc.AgentLoopEvent) { ch <- e })
	t.Cleanup(func() { agentloopsvc.SetStateTestHook(nil) })
	return ch
}

// awaitState drains ch until it sees want, or fails after 10s -- every
// scenario below only cares about a handful of specific transitions
// (calling-tool for X, awaiting-approval, done/failed/cancelled), never
// the exact full sequence, so this skips anything else in between.
func awaitState(t *testing.T, ch chan agentloopsvc.AgentLoopEvent, want agentloopsvc.LoopState) agentloopsvc.AgentLoopEvent {
	t.Helper()
	deadline := time.After(10 * time.Second)
	for {
		select {
		case e := <-ch:
			if e.State == want {
				return e
			}
		case <-deadline:
			t.Fatalf("never saw state %q within 10s", want)
		}
	}
}

// --- scripting a fake OpenAI-compat provider, turn by turn ---

// scriptedToolCall is one tool call a scripted turn asks the loop to
// make.
type scriptedToolCall struct {
	id, name, argsJSON string
}

// scriptedTurn is one POST /v1/chat/completions response: either a
// plain final answer (text set, no calls) or one or more tool calls
// (toolCalls set) -- never both in these fixtures, though the real
// wire shape allows leading reasoning text alongside a call (proven
// separately in aiclient's own chat_tools_test.go).
type scriptedTurn struct {
	text      string
	toolCalls []scriptedToolCall
}

func scriptedTurnChunks(turn scriptedTurn) []string {
	var chunks []string
	if turn.text != "" {
		chunks = append(chunks, mustJSONString(map[string]any{
			"choices": []any{map[string]any{"delta": map[string]any{"content": turn.text}}},
		}))
	}
	for i, tc := range turn.toolCalls {
		chunks = append(chunks, mustJSONString(map[string]any{
			"choices": []any{map[string]any{"delta": map[string]any{
				"tool_calls": []any{map[string]any{
					"index": i, "id": tc.id,
					"function": map[string]any{"name": tc.name, "arguments": tc.argsJSON},
				}},
			}}},
		}))
	}
	if len(turn.toolCalls) > 0 {
		chunks = append(chunks, mustJSONString(map[string]any{"choices": []any{map[string]any{"finish_reason": "tool_calls"}}}))
	}
	return chunks
}

func mustJSONString(v any) string {
	b, err := json.Marshal(v)
	if err != nil {
		panic(err)
	}
	return string(b)
}

// scriptedProvider serves turns in order, one per POST call -- a call
// past the scripted list is a test bug (a scenario looping more than
// expected), reported via t.Errorf rather than panicking so the test's
// own failure message stays readable.
func scriptedProvider(t *testing.T, turns []scriptedTurn) *httptest.Server {
	t.Helper()
	var idx int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		i := int(atomic.AddInt32(&idx, 1)) - 1
		if i >= len(turns) {
			t.Errorf("scripted provider got call %d, only %d turns scripted", i+1, len(turns))
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		flusher, _ := w.(http.Flusher)
		for _, c := range scriptedTurnChunks(turns[i]) {
			_, _ = w.Write([]byte("data: " + c + "\n\n"))
			if flusher != nil {
				flusher.Flush()
			}
		}
		_, _ = w.Write([]byte("data: [DONE]\n\n"))
	}))
	t.Cleanup(srv.Close)
	return srv
}

// --- class floor (brief item 5): read tools never park, Atlas write
// tools do -- through the real plane (ConnectInMemoryClient), no mocks.

func TestAgentloopMCP_ClassFloor_ReadToolNeverParks(t *testing.T) {
	h := newAgentloopHarness(t)
	ctx := t.Context()
	session, err := h.svc.ConnectInMemoryClient(ctx, "class-floor-read")
	if err != nil {
		t.Fatalf("ConnectInMemoryClient: %v", err)
	}
	defer func() { _ = session.Close() }()

	res, err := session.CallTool(ctx, &mcp.CallToolParams{Name: "atlas_list_kinds"})
	if err != nil {
		t.Fatalf("atlas_list_kinds: transport error: %v", err)
	}
	if res.IsError {
		t.Fatalf("atlas_list_kinds: tool error: %+v", res.Content)
	}
	text := firstText(res)
	if containsParkedText(text) {
		t.Errorf("a read tool must never park, got: %s", text)
	}
}

func TestAgentloopMCP_ClassFloor_AtlasWriteParks(t *testing.T) {
	h := newAgentloopHarness(t)
	h.enableWrites(t)
	topicKindID := h.topicKindID(t)

	setCourtesyWindow(t, 20*time.Millisecond)

	ctx := t.Context()
	session, err := h.svc.ConnectInMemoryClient(ctx, "class-floor-write")
	if err != nil {
		t.Fatalf("ConnectInMemoryClient: %v", err)
	}
	defer func() { _ = session.Close() }()

	res, err := session.CallTool(ctx, &mcp.CallToolParams{Name: "atlas_propose_card_write", Arguments: map[string]any{
		"kindId": topicKindID, "title": "Class floor test card",
	}})
	if err != nil {
		t.Fatalf("atlas_propose_card_write: transport error: %v", err)
	}
	if res.IsError {
		t.Fatalf("atlas_propose_card_write: tool error: %+v", res.Content)
	}
	text := firstText(res)
	if !containsParkedText(text) {
		t.Errorf("an Atlas write tool must park pending approval, got: %s", text)
	}
}

// firstText/containsParkedText are the shared, small assertions the
// class-floor tests above need against a raw CallToolResult -- the
// full loop's own park detection (parseParkedWriteID) lives in
// agentloopsvc and is proven there; this only checks the tool's own
// wire response shape.
func firstText(res *mcp.CallToolResult) string {
	for _, c := range res.Content {
		if tc, ok := c.(*mcp.TextContent); ok {
			return tc.Text
		}
	}
	return ""
}

func containsParkedText(text string) bool {
	return strings.Contains(text, "parked pending human approval")
}
