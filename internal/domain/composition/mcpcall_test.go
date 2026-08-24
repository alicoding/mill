package composition

import (
	"errors"
	"reflect"
	"strings"
	"testing"
)

// resolveMCPArguments is the mcp-tool-call counterpart to
// resolveBindingValue (attributebinding_test.go covers that one) --
// these tests exercise it directly as a pure function, per
// docs/SPEC.md's own "typed attr: resolution" design: unlike
// resolveBindingValue, a resolved Attribute value must keep its real
// JSON type (a number stays a number), since MCP tool arguments are
// structured JSON, not flat strings.

func TestResolveMCPArguments_TypedAttributeStaysTyped(t *testing.T) {
	arguments := map[string]any{"count": "attr:n"}
	attrs := map[string]any{"n": float64(3)}

	got := resolveMCPArguments(arguments, attrs)

	if got["count"] != float64(3) {
		t.Errorf("got[%q] = %#v (%T), want float64(3)", "count", got["count"], got["count"])
	}
}

func TestResolveMCPArguments_BooleanAttributeStaysBoolean(t *testing.T) {
	arguments := map[string]any{"loud": "attr:isLoud"}
	attrs := map[string]any{"isLoud": true}

	got := resolveMCPArguments(arguments, attrs)

	if got["loud"] != true {
		t.Errorf("got[%q] = %#v, want true", "loud", got["loud"])
	}
}

func TestResolveMCPArguments_LiteralStringPassesThrough(t *testing.T) {
	arguments := map[string]any{"name": "hello"}

	got := resolveMCPArguments(arguments, map[string]any{})

	if got["name"] != "hello" {
		t.Errorf("got[%q] = %#v, want %q", "name", got["name"], "hello")
	}
}

func TestResolveMCPArguments_MissingAttributeResolvesToEmptyString(t *testing.T) {
	arguments := map[string]any{"name": "attr:doesNotExist"}

	got := resolveMCPArguments(arguments, map[string]any{})

	if got["name"] != "" {
		t.Errorf("got[%q] = %#v, want empty string", "name", got["name"])
	}
}

func TestResolveMCPArguments_NonStringValuesUntouched(t *testing.T) {
	arguments := map[string]any{
		"count":  float64(5),
		"loud":   true,
		"nested": map[string]any{"key": "attr:shouldNotResolve"},
		"list":   []any{"attr:alsoShouldNotResolve"},
	}
	attrs := map[string]any{"shouldNotResolve": "resolved", "alsoShouldNotResolve": "resolved"}

	got := resolveMCPArguments(arguments, attrs)

	if !reflect.DeepEqual(got, arguments) {
		t.Errorf("resolveMCPArguments mutated/altered non-string top-level values: got %#v, want %#v", got, arguments)
	}
}

func TestResolveMCPArguments_NilArgumentsHandled(t *testing.T) {
	got := resolveMCPArguments(nil, map[string]any{"n": float64(1)})

	if got != nil {
		t.Errorf("resolveMCPArguments(nil, ...) = %#v, want nil", got)
	}
}

func TestResolveMCPArguments_DoesNotMutateInput(t *testing.T) {
	arguments := map[string]any{"count": "attr:n"}
	attrs := map[string]any{"n": float64(7)}

	_ = resolveMCPArguments(arguments, attrs)

	if arguments["count"] != "attr:n" {
		t.Errorf("resolveMCPArguments mutated its input map: arguments[%q] = %#v, want %q", "count", arguments["count"], "attr:n")
	}
}

func TestResolveMCPArguments_NilAttrsHandled(t *testing.T) {
	arguments := map[string]any{"name": "attr:missing", "literal": "kept"}

	got := resolveMCPArguments(arguments, nil)

	if got["name"] != "" {
		t.Errorf("got[%q] = %#v, want empty string", "name", got["name"])
	}
	if got["literal"] != "kept" {
		t.Errorf("got[%q] = %#v, want %q", "literal", got["literal"], "kept")
	}
}

// TestMCPToolCall_ErrorTextRedacted proves an mcp-tool-call node's own
// error text is run through redactSecretsFn before it leaves the node
// (goal 0185 S4) -- a server started with an injected vault secret
// could echo it back in its own failure message.
func TestMCPToolCall_ErrorTextRedacted(t *testing.T) {
	origLookup, origCall, origRedact := lookupMCPServerFn, callToolFn, redactSecretsFn
	t.Cleanup(func() { lookupMCPServerFn, callToolFn, redactSecretsFn = origLookup, origCall, origRedact })

	SetMCPServerLookup(func(string) (ResolvedMCPServer, error) {
		return ResolvedMCPServer{Command: "irrelevant"}, nil
	})
	SetMCPCallTool(func(string, []string, []string, string, map[string]any, string) (string, error) {
		return "", errors.New("auth failed for token super-secret-fake")
	})
	SetSecretRedactor(func(s string) string { return strings.ReplaceAll(s, "super-secret-fake", "[redacted]") })

	nodes, edges := chain("trigger-manual", "mcp-tool-call")
	resolved, err := ResolveNodeDefaults(nodes)
	if err != nil {
		t.Fatalf("ResolveNodeDefaults: %v", err)
	}
	for i := range resolved {
		if resolved[i].NodeTypeID == "mcp-tool-call" {
			resolved[i].Config["mcpServerId"] = "any"
			resolved[i].Config["toolName"] = "any"
		}
	}

	_, err = ExecuteWorkflow(resolved, edges, nil)
	if err == nil {
		t.Fatal("ExecuteWorkflow returned nil error, want the mcp-tool-call failure")
	}
	if strings.Contains(err.Error(), "super-secret-fake") {
		t.Fatalf("ExecuteWorkflow error = %q, still contains the unredacted secret", err.Error())
	}
	if !strings.Contains(err.Error(), "[redacted]") {
		t.Fatalf("ExecuteWorkflow error = %q, want it to contain the redaction placeholder", err.Error())
	}
}
