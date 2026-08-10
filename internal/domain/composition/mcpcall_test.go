package composition

import (
	"reflect"
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
