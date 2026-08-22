package mcpsvc

import (
	"strings"
	"testing"
	"time"

	"github.com/alicoding/mill/internal/services/agentloopsvc"
)

// The full agent-loop proof (goal 0101 slice 1's own brief): a
// multi-step goal mixing reads and a write, the parked-write
// pause/resume cycle (approved via the REAL approval service,
// ResolveMCPWrite -- the same method Mill's own approval UI calls),
// denial re-plan, the max-turns stop, and cancellation mid-turn. Every
// scenario drives the real AgentLoopService against the real
// MillMCPService via ConnectInMemoryClient -- no mocks of Mill's own
// server, no mocks of the approval plane.

// TestAgentloopMCP_MultiStepGoal_TwoReadsThenWriteThenFinalAnswer
// proves the loop's basic turn machinery end to end: two read tool
// calls, then a write that executes immediately (approval NOT required
// for this scenario -- the dedicated pause/resume proof below covers
// the parked case), then a plain final answer.
func TestAgentloopMCP_MultiStepGoal_TwoReadsThenWriteThenFinalAnswer(t *testing.T) {
	h := newAgentloopHarness(t)
	h.enableWrites(t)
	if err := h.store.Set(MCPWriteApprovalKey, "false"); err != nil {
		t.Fatalf("disable per-write approval: %v", err)
	}
	topicKindID := h.topicKindID(t)

	srv := scriptedProvider(t, []scriptedTurn{
		{toolCalls: []scriptedToolCall{{id: "c1", name: "atlas_list_kinds"}}},
		{toolCalls: []scriptedToolCall{{id: "c2", name: "atlas_search_cards", argsJSON: `{"query":"Ada"}`}}},
		{toolCalls: []scriptedToolCall{{id: "c3", name: "atlas_propose_card_write", argsJSON: mustJSONString(map[string]any{
			"kindId": topicKindID, "title": "Multi-step goal card",
		})}}},
		{text: "Done: read the kinds, searched for Ada, and created the card."},
	})
	h.wireProvider(t, srv)

	ch := h.events(t)
	sessionID, err := h.loop.StartGoal("test-provider", "m", "read some Atlas data and create a card")
	if err != nil {
		t.Fatalf("StartGoal: %v", err)
	}

	var tools []string
	for {
		e := <-ch
		if e.SessionID != sessionID {
			continue
		}
		if e.State == agentloopsvc.StateCallingTool {
			tools = append(tools, e.ToolName)
		}
		if e.State == agentloopsvc.StateDone {
			if !strings.Contains(e.Text, "created the card") {
				t.Errorf("final text = %q, want it to mention the created card", e.Text)
			}
			break
		}
		if e.State == agentloopsvc.StateFailed || e.State == agentloopsvc.StateCancelled {
			t.Fatalf("goal ended in %s: %+v", e.State, e)
		}
	}
	want := []string{"atlas_list_kinds", "atlas_search_cards", "atlas_propose_card_write"}
	if len(tools) != len(want) {
		t.Fatalf("tools called = %v, want %v", tools, want)
	}
	for i, name := range want {
		if tools[i] != name {
			t.Errorf("tools[%d] = %q, want %q (sequential order)", i, tools[i], name)
		}
	}
}

// TestAgentloopMCP_ParkedWrite_PauseThenApproveResumes proves the
// pause/resume cycle: a gated write parks (awaiting-approval, the
// design contract's own state), the loop polls check_write_status
// through the real MCP session, and approving via ResolveMCPWrite (the
// SAME method Mill's approval UI calls) resumes the loop with the
// write's own result fed back as the tool's outcome.
func TestAgentloopMCP_ParkedWrite_PauseThenApproveResumes(t *testing.T) {
	h := newAgentloopHarness(t)
	h.enableWrites(t)
	// Approval key left unset: required is the default -- the write
	// must actually park, not resolve inside gateWrite's own courtesy
	// window.
	setCourtesyWindow(t, 30*time.Millisecond)
	agentloopsvc.SetWriteStatusPollIntervalForTest(10 * time.Millisecond)
	t.Cleanup(func() { agentloopsvc.SetWriteStatusPollIntervalForTest(2 * time.Second) })
	topicKindID := h.topicKindID(t)

	srv := scriptedProvider(t, []scriptedTurn{
		{toolCalls: []scriptedToolCall{{id: "c1", name: "atlas_propose_card_write", argsJSON: mustJSONString(map[string]any{
			"kindId": topicKindID, "title": "Parked pause/resume card",
		})}}},
		{text: "The card was created after approval."},
	})
	h.wireProvider(t, srv)

	ch := h.events(t)
	sessionID, err := h.loop.StartGoal("test-provider", "m", "create a card, it will need approval")
	if err != nil {
		t.Fatalf("StartGoal: %v", err)
	}

	var writeID string
	for {
		e := <-ch
		if e.SessionID != sessionID {
			continue
		}
		if e.State == agentloopsvc.StateAwaitingApproval {
			writeID = e.WriteID
			break
		}
		if e.State == agentloopsvc.StateFailed || e.State == agentloopsvc.StateCancelled {
			t.Fatalf("goal ended in %s before parking: %+v", e.State, e)
		}
	}
	if writeID == "" {
		t.Fatal("awaiting-approval event carried no WriteID")
	}

	if err := h.svc.ResolveMCPWrite(writeID, true); err != nil {
		t.Fatalf("ResolveMCPWrite(approve): %v", err)
	}

	for {
		e := <-ch
		if e.SessionID != sessionID {
			continue
		}
		if e.State == agentloopsvc.StateDone {
			if !strings.Contains(e.Text, "approval") {
				t.Errorf("final text = %q, want it to reflect the resumed turn", e.Text)
			}
			break
		}
		if e.State == agentloopsvc.StateFailed || e.State == agentloopsvc.StateCancelled {
			t.Fatalf("goal ended in %s after approval: %+v", e.State, e)
		}
	}

	createdID := h.cardIDByTitle(t, "Parked pause/resume card")
	if createdID == "" {
		t.Error("the approved write never actually created the card")
	}
}

// TestAgentloopMCP_ParkedWrite_DenialFeedsRefusalTextForReplan proves
// the OTHER resolution: a denied write's refusal text becomes the tool
// result (never a loop failure), and the model's next scripted turn --
// standing in for a real re-plan -- runs normally to done.
func TestAgentloopMCP_ParkedWrite_DenialFeedsRefusalTextForReplan(t *testing.T) {
	h := newAgentloopHarness(t)
	h.enableWrites(t)
	setCourtesyWindow(t, 30*time.Millisecond)
	agentloopsvc.SetWriteStatusPollIntervalForTest(10 * time.Millisecond)
	t.Cleanup(func() { agentloopsvc.SetWriteStatusPollIntervalForTest(2 * time.Second) })
	topicKindID := h.topicKindID(t)

	srv := scriptedProvider(t, []scriptedTurn{
		{toolCalls: []scriptedToolCall{{id: "c1", name: "atlas_propose_card_write", argsJSON: mustJSONString(map[string]any{
			"kindId": topicKindID, "title": "Denied card",
		})}}},
		{text: "Understood -- the write was denied, so I won't create the card."},
	})
	h.wireProvider(t, srv)

	ch := h.events(t)
	sessionID, err := h.loop.StartGoal("test-provider", "m", "create a card")
	if err != nil {
		t.Fatalf("StartGoal: %v", err)
	}

	var writeID string
	for writeID == "" {
		e := <-ch
		if e.SessionID == sessionID && e.State == agentloopsvc.StateAwaitingApproval {
			writeID = e.WriteID
		}
	}
	if err := h.svc.ResolveMCPWrite(writeID, false); err != nil {
		t.Fatalf("ResolveMCPWrite(deny): %v", err)
	}

	for {
		e := <-ch
		if e.SessionID != sessionID {
			continue
		}
		if e.State == agentloopsvc.StateDone {
			if !strings.Contains(e.Text, "denied") {
				t.Errorf("final text = %q, want the re-plan turn to acknowledge the denial", e.Text)
			}
			break
		}
		if e.State == agentloopsvc.StateFailed || e.State == agentloopsvc.StateCancelled {
			t.Fatalf("a denial must let the model re-plan, not fail the loop: %s %+v", e.State, e)
		}
	}
	if id := h.cardIDByTitle(t, "Denied card"); id != "" {
		t.Error("a denied write must never actually create the card")
	}
}

// TestAgentloopMCP_MaxTurnsStop_EmitsFailed proves the loop stops
// itself, as StateFailed, once it hits its own turn bound -- scripted
// with a provider that ALWAYS asks for another read tool call, so
// nothing but the bound itself could end this goal.
func TestAgentloopMCP_MaxTurnsStop_EmitsFailed(t *testing.T) {
	h := newAgentloopHarness(t)
	agentloopsvc.SetMaxTurnsForTest(2)
	t.Cleanup(func() { agentloopsvc.SetMaxTurnsForTest(agentloopsvc.DefaultMaxTurns) })

	turns := make([]scriptedTurn, 5)
	for i := range turns {
		turns[i] = scriptedTurn{toolCalls: []scriptedToolCall{{id: "c", name: "atlas_list_kinds"}}}
	}
	srv := scriptedProvider(t, turns)
	h.wireProvider(t, srv)

	ch := h.events(t)
	sessionID, err := h.loop.StartGoal("test-provider", "m", "a goal that never converges")
	if err != nil {
		t.Fatalf("StartGoal: %v", err)
	}

	e := awaitState(t, ch, agentloopsvc.StateFailed)
	if e.SessionID != sessionID {
		t.Fatalf("failed event for the wrong session: %+v", e)
	}
	if !strings.Contains(e.Text, "2-turn limit") {
		t.Errorf("failure text = %q, want it to name the turn limit", e.Text)
	}
}

// TestAgentloopMCP_CancelMidTurn_StopsWhilePolling proves
// CancelGoal actually stops a loop that's mid-poll waiting on a parked
// write's approval -- ctx cancellation must win over an indefinitely
// pending human decision.
func TestAgentloopMCP_CancelMidTurn_StopsWhilePolling(t *testing.T) {
	h := newAgentloopHarness(t)
	h.enableWrites(t)
	setCourtesyWindow(t, 20*time.Millisecond)
	agentloopsvc.SetWriteStatusPollIntervalForTest(10 * time.Millisecond)
	t.Cleanup(func() { agentloopsvc.SetWriteStatusPollIntervalForTest(2 * time.Second) })
	topicKindID := h.topicKindID(t)

	srv := scriptedProvider(t, []scriptedTurn{
		{toolCalls: []scriptedToolCall{{id: "c1", name: "atlas_propose_card_write", argsJSON: mustJSONString(map[string]any{
			"kindId": topicKindID, "title": "Never approved card",
		})}}},
	})
	h.wireProvider(t, srv)

	ch := h.events(t)
	sessionID, err := h.loop.StartGoal("test-provider", "m", "create a card")
	if err != nil {
		t.Fatalf("StartGoal: %v", err)
	}
	awaitState(t, ch, agentloopsvc.StateAwaitingApproval)

	if err := h.loop.CancelGoal(sessionID); err != nil {
		t.Fatalf("CancelGoal: %v", err)
	}
	awaitState(t, ch, agentloopsvc.StateCancelled)
}

// cardIDByTitle looks up a real Atlas card by title -- t.Helper so a
// failure attributes to the caller, empty string when no such card
// exists (a valid, checked outcome for the denial test above).
func (h *agentloopHarness) cardIDByTitle(t *testing.T, title string) string {
	t.Helper()
	for _, c := range h.atlas.Cards() {
		if c.Title == title {
			return c.ID
		}
	}
	return ""
}

// setCourtesyWindow shrinks the package's own mcpWriteCourtesyWindow
// var for the duration of one test (restored via t.Cleanup) -- the
// same in-package-test-file pattern millmcpservice_approval_test.go
// already establishes, reused here rather than re-derived per test.
func setCourtesyWindow(t *testing.T, d time.Duration) {
	t.Helper()
	orig := mcpWriteCourtesyWindow
	mcpWriteCourtesyWindow = d
	t.Cleanup(func() { mcpWriteCourtesyWindow = orig })
}
