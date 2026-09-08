package main

import (
	"errors"
	"strings"
	"testing"
)

// These two doors (goal 0381) only function against an mcp-tagged
// build carrying window.__millRunCommand / DevBridgeQuit -- exercised
// here against the same scripted fakeCaller every other check test in
// this package uses, never a real desktop process.
func TestRunCommand_Ok(t *testing.T) {
	f := newFakeCaller()
	f.onJSON("js_eval", driveRunCommandResult{Ok: true})
	result, err := runCommand(f, "settings.open", nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !result.Ok {
		t.Fatalf("expected ok=true, got %+v", result)
	}
	if len(f.calls) != 1 || f.calls[0].tool != "js_eval" {
		t.Fatalf("expected one js_eval call, got %+v", f.calls)
	}
	js, _ := f.calls[0].args["js"].(string)
	if !strings.Contains(js, `"settings.open"`) {
		t.Errorf("js body does not carry the command id: %s", js)
	}
	if !strings.Contains(js, "undefined") {
		t.Errorf("a nil ctx should marshal as the JS literal undefined, got: %s", js)
	}
}

func TestRunCommand_ReportsFailureWithoutError(t *testing.T) {
	f := newFakeCaller()
	f.onJSON("js_eval", driveRunCommandResult{Ok: false, Error: "unknown command: bogus.id"})
	result, err := runCommand(f, "bogus.id", nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.Ok {
		t.Fatalf("expected ok=false, got %+v", result)
	}
	if result.Error != "unknown command: bogus.id" {
		t.Errorf("unexpected error text: %q", result.Error)
	}
}

func TestRunCommand_MarshalsCtx(t *testing.T) {
	f := newFakeCaller()
	f.onJSON("js_eval", driveRunCommandResult{Ok: true})
	if _, err := runCommand(f, "atlas.card.open", map[string]any{"kind": "card", "cardId": "c1"}); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	js, _ := f.calls[0].args["js"].(string)
	if !strings.Contains(js, `"cardId":"c1"`) {
		t.Errorf("ctx did not marshal into the js body: %s", js)
	}
}

func TestRunCommand_BridgeGapPropagates(t *testing.T) {
	f := newFakeCaller()
	f.onError("js_eval", &bridgeGapError{tool: "js_eval", message: "unknown tool: js_eval"})
	if _, err := runCommand(f, "settings.open", nil); err == nil {
		t.Fatal("expected the bridge-gap error to propagate")
	}
}

func TestQuitApp_CallsDevBridgeQuit(t *testing.T) {
	f := newFakeCaller()
	f.on("call_bound_method", func(args map[string]any) (string, error) {
		return "null", nil
	})
	quitApp(f)
	if len(f.calls) != 1 {
		t.Fatalf("expected exactly one call, got %d", len(f.calls))
	}
	call := f.calls[0]
	if call.tool != "call_bound_method" {
		t.Fatalf("expected call_bound_method, got %q", call.tool)
	}
	name, _ := call.args["name"].(string)
	if name != "github.com/alicoding/mill/internal/services/settingssvc.SettingsService.DevBridgeQuit" {
		t.Errorf("unexpected bound method name: %q", name)
	}
}

// A quit's HTTP response may never arrive if the process exits first
// -- quitApp must not surface that as a failure to its caller (it
// returns nothing to check), only never panic.
func TestQuitApp_ToleratesConnectionError(t *testing.T) {
	f := newFakeCaller()
	f.onError("call_bound_method", errors.New("connection reset by peer"))
	quitApp(f) // must not panic
	if len(f.calls) != 1 {
		t.Fatalf("expected the call to still be attempted, got %d calls", len(f.calls))
	}
}
