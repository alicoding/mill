package agentloopsvc

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/alicoding/mill/internal/adapters/aiclient"
	"github.com/alicoding/mill/internal/adapters/mcpaudit"
	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// DefaultMaxTurns is the loop's own bound on how many model turns one
// goal may take before it stops itself -- the design contract's own
// "max turns (default 12)" hard bound. A turn that ends in a tool call
// (read or write) still counts as one turn even though it triggers a
// further model call; this simply prevents an unbounded back-and-forth
// against a goal that never converges.
const DefaultMaxTurns = 12

// maxTurns is DefaultMaxTurns, overridable in tests via
// SetMaxTurnsForTest -- package var rather than a constructor
// parameter since S1 has no product surface for configuring it yet
// (S2's UI may expose this per-session; until then one process-wide
// default is the honest state of the world).
var maxTurns = DefaultMaxTurns

// SetMaxTurnsForTest overrides maxTurns -- test-only, restore via
// t.Cleanup.
func SetMaxTurnsForTest(n int) { maxTurns = n }

// DefaultContextByteCap is the loop's own context-size guard: the
// transcript (every message's Content plus every tool call's
// Arguments/result text, summed) may not grow past this many bytes
// before a turn starts. 256KiB is chosen to comfortably fit many turns
// of tool calls/results against even a modest local-model context
// window (an 8k-32k token Ollama model is roughly 32-128KB of text)
// while still bounding memory and per-request payload size regardless
// of which BYO endpoint a session is pointed at -- Mill has no way to
// know a configured provider's actual context window, so this is a
// deliberately generous, provider-agnostic ceiling rather than a
// per-model-tuned one.
const DefaultContextByteCap = 256 * 1024

var contextByteCap = DefaultContextByteCap

// SetContextByteCapForTest overrides contextByteCap -- test-only,
// restore via t.Cleanup.
func SetContextByteCapForTest(n int) { contextByteCap = n }

// writeStatusPollInterval is how often the loop polls check_write_status
// for a parked write -- the same "sensible interval" ReviewView's own
// 2s poll already establishes as this codebase's precedent for
// approval-adjacent polling. The write's own timeout (mcpWriteExpiry,
// 24h) is enforced server-side; this loop has no separate timeout of
// its own beyond the caller's context (CancelGoal is always available
// while a goal waits on a human).
var writeStatusPollInterval = 2 * time.Second

// SetWriteStatusPollIntervalForTest overrides writeStatusPollInterval
// -- test-only, restore via t.Cleanup.
func SetWriteStatusPollIntervalForTest(d time.Duration) { writeStatusPollInterval = d }

// chatFn defaults to aiclient.Chat -- overridable in tests, same seam
// shape companionsvc.chatFn already establishes.
var chatFn = aiclient.Chat

// agentSystemPrompt is the loop's own fixed system turn -- goal-neutral
// on purpose (the actual goal travels as the first user message), and
// silent about specific tool names since the tool list itself already
// carries that.
const agentSystemPrompt = "You are working one user-scoped goal by calling the tools available to you. " +
	"A write may pause for a human's approval -- when that happens, wait for the tool's result before continuing; " +
	"if it was denied, either try a different approach or explain why the goal can't be completed. " +
	"Once the goal is complete, give a plain final answer with no further tool calls."

// errContextTooLarge is one of the loop's two "stopped without
// completing the goal" reasons -- both surface as StateFailed (the
// design contract's state vocabulary has no separate "stopped by its
// own bound" state; a goal that hits either bound genuinely did NOT
// complete, so failed is the honest state, not done). The other,
// max-turns, is rendered by maxTurnsError below since its own count is
// an overridable var, not a fixed constant.
var errContextTooLarge = errors.New("conversation grew past the context-size cap before the goal completed")

// maxTurnsError renders the loop's own max-turns-stop message against
// whatever maxTurns is set to right now (SetMaxTurnsForTest included),
// so the emitted text always matches the bound that actually fired.
func maxTurnsError() string {
	return fmt.Sprintf("reached the %d-turn limit before the goal completed", maxTurns)
}

// buildToolDefs converts one ListTools result into aiclient's own
// wire-agnostic ToolDef list -- Annotations (readOnlyHint/
// destructiveHint) are deliberately never read here: they're
// self-reported by whatever server exposes the tool and untrusted per
// the MCP spec (docs/SPEC.md §3.1's added note), so nothing about
// which tools this loop may call or how it treats their results is
// ever decided from them.
func buildToolDefs(tools []*mcp.Tool) ([]aiclient.ToolDef, error) {
	defs := make([]aiclient.ToolDef, 0, len(tools))
	for _, t := range tools {
		schema, err := json.Marshal(t.InputSchema)
		if err != nil {
			return nil, fmt.Errorf("agentloop: marshal input schema for tool %q: %w", t.Name, err)
		}
		defs = append(defs, aiclient.ToolDef{Name: t.Name, Description: t.Description, InputSchema: schema})
	}
	return defs, nil
}

// transcriptBytes sums the transcript's own byte footprint -- every
// message's Content plus every tool call's Arguments, the same fields
// that actually travel on the wire each turn (aiclient.Chat re-sends
// the full Messages slice every call, per its own doc comment).
func transcriptBytes(messages []aiclient.ChatMessage) int {
	n := 0
	for _, m := range messages {
		n += len(m.Content)
		for _, tc := range m.ToolCalls {
			n += len(tc.Name) + len(tc.Arguments)
		}
	}
	return n
}

// run is the loop itself -- one goroutine per StartGoal call. Every
// early return happens through exactly one of the emit* terminal calls
// below (most inside setupRun/runOneTurn), so a caller watching
// StateEventName always sees a terminal state exactly once per
// session.
func (s *AgentLoopService) run(ctx context.Context, sessionID, aiProviderID, model, goal string) {
	defer s.endSession(sessionID)

	// Every MCP call this goroutine makes from here on carries this
	// session's own caller identity (goal 0159 slice 1's audit trail) --
	// set once, threaded through setupRun/runOneTurn/runToolCalls/
	// callOneTool/pollWriteStatus via the same ctx value each already
	// passes along, never re-derived per call.
	ctx = mcpaudit.WithCallerIdentity(ctx, "agentloop-"+sessionID)

	rp, session, toolDefs, ok := s.setupRun(ctx, sessionID, aiProviderID)
	if !ok {
		return
	}
	defer func() { _ = session.Close() }()

	messages := []aiclient.ChatMessage{{Role: "user", Content: goal}}
	for turn := 0; turn < maxTurns; turn++ {
		if stop := s.runOneTurn(ctx, sessionID, model, rp, session, toolDefs, &messages); stop {
			return
		}
	}

	emitState(sessionID, StateFailed, "", "", maxTurnsError())
}

// setupRun resolves the provider and opens the goal's real MCP client
// session -- split out of run purely to keep that function's own
// cognitive complexity under the repo's gate. ok is false after any
// failure, with the terminal StateFailed event already emitted; the
// caller returns immediately in that case.
func (s *AgentLoopService) setupRun(ctx context.Context, sessionID, aiProviderID string) (composition.ResolvedAIProvider, *mcp.ClientSession, []aiclient.ToolDef, bool) {
	rp, err := composition.ResolveAIProvider(aiProviderID)
	if err != nil {
		emitState(sessionID, StateFailed, "", "", err.Error())
		return composition.ResolvedAIProvider{}, nil, nil, false
	}

	session, err := s.mcp.ConnectInMemoryClient(ctx, "agentloop-"+sessionID)
	if err != nil {
		emitState(sessionID, StateFailed, "", "", err.Error())
		return composition.ResolvedAIProvider{}, nil, nil, false
	}

	listed, err := session.ListTools(ctx, nil)
	if err != nil {
		emitState(sessionID, StateFailed, "", "", fmt.Sprintf("list tools: %s", err))
		return composition.ResolvedAIProvider{}, nil, nil, false
	}
	toolDefs, err := buildToolDefs(listed.Tools)
	if err != nil {
		emitState(sessionID, StateFailed, "", "", err.Error())
		return composition.ResolvedAIProvider{}, nil, nil, false
	}
	return rp, session, toolDefs, true
}

// runOneTurn runs exactly one model turn (plus every tool call it
// requests) and folds the result onto *messages -- split out of run
// purely to keep that function's own cognitive complexity under the
// repo's gate. stop reports any terminal outcome (done, cancelled, or
// failed -- the state already emitted either way), telling run to
// return without looping further; false means the goal continues into
// another turn.
func (s *AgentLoopService) runOneTurn(ctx context.Context, sessionID, model string, rp composition.ResolvedAIProvider, session *mcp.ClientSession, toolDefs []aiclient.ToolDef, messages *[]aiclient.ChatMessage) bool {
	if ctx.Err() != nil {
		emitState(sessionID, StateCancelled, "", "", "")
		return true
	}
	if transcriptBytes(*messages) > contextByteCap {
		emitState(sessionID, StateFailed, "", "", errContextTooLarge.Error())
		return true
	}

	emitState(sessionID, StateThinking, "", "", "")
	res, err := chatFn(aiclient.ChatRequest{
		Kind: aiclient.Kind(rp.Kind), BaseURL: rp.BaseURL, Model: model, APIKey: rp.APIKey,
		System: agentSystemPrompt, Messages: *messages, Tools: toolDefs,
	}, func(delta string) { emitDelta(sessionID, delta) })
	if err != nil {
		emitState(sessionID, StateFailed, "", "", err.Error())
		return true
	}

	if len(res.ToolCalls) == 0 {
		emitState(sessionID, StateDone, "", "", res.Text)
		return true
	}

	*messages = append(*messages, aiclient.ChatMessage{Role: "assistant", Content: res.Text, ToolCalls: res.ToolCalls})
	cancelled, failMsg := s.runToolCalls(ctx, sessionID, session, res.ToolCalls, messages)
	if cancelled {
		emitState(sessionID, StateCancelled, "", "", "")
		return true
	}
	if failMsg != "" {
		emitState(sessionID, StateFailed, "", "", failMsg)
		return true
	}
	return false
}

// runToolCalls executes every tool call from one turn, IN ORDER, one at
// a time -- v1's own deliberate parallel-tool-calls policy: a provider
// may return more than one call in a single turn (aiclient.ChatResult.ToolCalls),
// but this loop never fans them out concurrently, both because a
// parked write's approval prompt would otherwise show multiple
// simultaneous asks with no clear ordering, and because a later call in
// the same turn may reasonably depend on an earlier one's result.
// Appends each call's tool-role result onto *messages as it completes,
// so a later call in the same batch (and the next turn) sees it.
func (s *AgentLoopService) runToolCalls(ctx context.Context, sessionID string, session *mcp.ClientSession, calls []aiclient.ToolCall, messages *[]aiclient.ChatMessage) (cancelled bool, failMsg string) {
	for _, tc := range calls {
		if ctx.Err() != nil {
			return true, ""
		}
		emitState(sessionID, StateCallingTool, tc.Name, "", "")

		text, err := s.callOneTool(ctx, sessionID, session, tc)
		if err != nil {
			if errors.Is(err, context.Canceled) || ctx.Err() != nil {
				return true, ""
			}
			return false, err.Error()
		}
		*messages = append(*messages, aiclient.ChatMessage{Role: "tool", ToolCallID: tc.ID, Content: text})
	}
	return false, ""
}

// callOneTool calls tc through the real MCP session and, when the
// result is a parked write, pauses (awaiting-approval) and polls
// check_write_status until the human decides or ctx is cancelled. A
// tool-level error (res.IsError) is NOT a loop failure -- its text
// becomes the tool result exactly like a success, so the model can see
// what went wrong and self-correct next turn (the same reasoning
// CallToolResult.IsError's own SDK doc comment states).
func (s *AgentLoopService) callOneTool(ctx context.Context, sessionID string, session *mcp.ClientSession, tc aiclient.ToolCall) (string, error) {
	var args map[string]any
	if len(tc.Arguments) > 0 {
		if err := json.Unmarshal(tc.Arguments, &args); err != nil {
			return fmt.Sprintf("error: the model's tool call arguments were not valid JSON: %s", err), nil
		}
	}
	res, err := session.CallTool(ctx, &mcp.CallToolParams{Name: tc.Name, Arguments: args})
	if err != nil {
		return "", err
	}
	text := mcpaudit.ContentText(res.Content)
	if res.IsError {
		return text, nil
	}

	// Parses gateWrite's own canonical park-response text (mcpsvc's
	// millmcpservice_approval.go, docs/adr/0032) via the one shared
	// helper every reader of that wire contract uses -- this loop never
	// imports mcpsvc directly, per its own doc comment above.
	writeID, parked := mcpaudit.ParseParkedWriteID(text)
	if !parked {
		return text, nil
	}

	emitState(sessionID, StateAwaitingApproval, tc.Name, writeID, "")
	return s.pollWriteStatus(ctx, session, writeID)
}

// checkWriteStatusResult mirrors mcpsvc's own (unexported)
// checkWriteStatusResult JSON shape -- check_write_status's documented
// response contract every MCP client (including this loop) decodes
// against, not a private type shared across packages.
type checkWriteStatusResult struct {
	Status string `json:"status"`
	Result string `json:"result,omitempty"`
	Error  string `json:"error,omitempty"`
}

// pollWriteStatus polls check_write_status for id at
// writeStatusPollInterval until it resolves or ctx is cancelled --
// approved feeds the write's own success text back as the tool result
// (so the model sees what actually happened, e.g. a created card's
// id); denied/cancelled/expired feed back a plain refusal the model may
// re-plan around, per the design contract's own pause/resume clause.
func (s *AgentLoopService) pollWriteStatus(ctx context.Context, session *mcp.ClientSession, id string) (string, error) {
	ticker := time.NewTicker(writeStatusPollInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return "", ctx.Err()
		case <-ticker.C:
		}
		res, err := session.CallTool(ctx, &mcp.CallToolParams{Name: "check_write_status", Arguments: map[string]any{"id": id}})
		if err != nil {
			return "", err
		}
		var out checkWriteStatusResult
		if err := json.Unmarshal([]byte(mcpaudit.ContentText(res.Content)), &out); err != nil {
			return "", fmt.Errorf("agentloop: parse check_write_status result: %w", err)
		}
		switch out.Status {
		case "pending":
			continue
		case "approved":
			if out.Result != "" {
				return out.Result, nil
			}
			return "the write was approved", nil
		default:
			return fmt.Sprintf("the write was %s: %s", out.Status, out.Error), nil
		}
	}
}
