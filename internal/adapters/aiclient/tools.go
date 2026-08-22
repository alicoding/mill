package aiclient

import (
	"encoding/json"
	"strings"
)

// ToolDef declares one callable tool available to the model for a Chat
// turn -- Mill's own MCP tool listing (agentloopsvc, docs/goals/0101
// slice 1) converts each *mcp.Tool into one ToolDef; this package stays
// free of any MCP import (the same domain-agnostic-adapter boundary
// aiclient.go's own doc comment already states), so InputSchema travels
// as already-marshaled bytes rather than the SDK's own schema type.
type ToolDef struct {
	Name        string
	Description string
	// InputSchema is a JSON Schema object (the same raw-bytes convention
	// SchemaSpec.Schema above already uses) describing the tool's
	// expected arguments.
	InputSchema []byte
}

// ToolCall is one invocation the model requested during a Chat turn --
// ID is the wire shape's own call identifier (OpenAI's tool_calls[].id,
// Anthropic's tool_use block id), echoed back on the ChatMessage that
// carries this call's result (ToolCallID) so a multi-call turn's
// results can't be misattributed.
type ToolCall struct {
	ID        string
	Name      string
	Arguments json.RawMessage
}

// ChatResult is Chat's return value once a turn -- and its stream, if
// any -- completes. Text is the model's own prose for this turn (may be
// empty when the turn is pure tool-calling); ToolCalls is every tool
// call the model requested this turn, in the order the wire shape
// reported them -- a caller that gets more than one back is seeing
// parallel tool calls, which this package makes no attempt to
// execute for it (docs/goals/0101 slice 1: the agent loop executes them
// sequentially, one call at a time, and is the only thing that decides
// execution order).
type ChatResult struct {
	Text      string
	ToolCalls []ToolCall
}

// buildingToolCall accumulates one streamed tool call's id/name/
// arguments across multiple SSE chunks/events -- the shared shape both
// wire adapters' streaming accumulation uses (openaicompat.go's
// tool_calls[].function.arguments fragments, anthropic.go's
// input_json_delta partial_json fragments), keyed by the wire shape's
// own per-call stream index.
type buildingToolCall struct {
	id, name string
	args     strings.Builder
}

// finish renders one accumulated tool call as the wire-agnostic
// ToolCall a caller receives. A tool call whose wire shape streamed no
// argument fragments at all (a no-argument tool) still needs valid JSON
// here, not an empty string -- callers (agentloopsvc) json.Unmarshal
// this directly into the args map they pass to MCP's CallTool.
func (b *buildingToolCall) finish() ToolCall {
	args := b.args.String()
	if args == "" {
		args = "{}"
	}
	return ToolCall{ID: b.id, Name: b.name, Arguments: json.RawMessage(args)}
}

// finishToolCalls renders every accumulated call in order (the order
// each call's index first appeared in the stream) -- shared by both
// chatOpenAICompat and chatAnthropic once their own stream scan ends.
func finishToolCalls(calls map[int]*buildingToolCall, order []int) []ToolCall {
	if len(order) == 0 {
		return nil
	}
	out := make([]ToolCall, 0, len(order))
	for _, idx := range order {
		out = append(out, calls[idx].finish())
	}
	return out
}
