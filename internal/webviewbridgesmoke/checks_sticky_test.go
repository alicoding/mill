package main

import (
	"errors"
	"strings"
	"testing"
)

func TestCheckStickyBorderColorFlip(t *testing.T) {
	seedCards := []atlasCard{{ID: "card-1", Title: "Discovery workstream", ParentID: "space-1"}}

	t.Run("border-color and ring both flip on selection", func(t *testing.T) {
		f := newFakeCaller()
		f.onJSON("call_bound_method", seedCards)
		f.on("js_eval", func(map[string]any) (string, error) { return "chained", nil }) // repairAppDispatch after Cards
		f.onJSON("call_bound_method", map[string]any{"ID": "note-1"})
		f.on("js_eval", func(map[string]any) (string, error) { return "intact", nil }) // repairAppDispatch after CreateNote
		f.onJSON("js_eval", true)                                                      // pollJSEval: sticky rendered
		f.onJSON("js_eval", true)                                                      // waitForNodeStable: settled before the click
		f.onJSON("js_eval", stickySnapshot{BorderColor: "rgb(1,1,1)", BoxShadow: "none", Selected: false})
		f.on("js_eval", func(map[string]any) (string, error) { return "clear", nil }) // hit-test: nothing covers the sticky
		f.on("mouse_click", func(map[string]any) (string, error) { return "ok", nil })
		f.onJSON("js_eval", true) // poll: shift-click selected the sticky
		f.onJSON("js_eval", stickySnapshot{BorderColor: "rgb(9,9,9)", BoxShadow: "0 0 0 3px accent", Selected: true})

		detail, err := checkStickyBorderColorFlip(f)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if !strings.Contains(detail, "rgb(1,1,1) -> rgb(9,9,9)") {
			t.Errorf("got %q", detail)
		}

		// The note must nest under "Discovery workstream"'s own ParentID
		// (the auto-entered board level), not under Discovery workstream's
		// own ID or the meta root -- regression for the level-mismatch
		// this check's design had to reason through explicitly.
		var createCall *calledTool
		for i := range f.calls {
			if f.calls[i].tool == "call_bound_method" && strings.Contains(f.calls[i].args["name"].(string), "CreateNote") {
				createCall = &f.calls[i]
			}
		}
		if createCall == nil {
			t.Fatal("CreateNote was never called")
			return // staticcheck SA5011: t.Fatal's noreturn fact is lost under CI's build config
		}
		args, _ := createCall.args["args"].([]any)
		if len(args) != 3 || args[2] != "space-1" {
			t.Errorf("expected CreateNote's parentID to be space-1 (Discovery workstream's own ParentID), got args=%v", args)
		}
	})

	t.Run("seeded card not found is an error, no note created", func(t *testing.T) {
		f := newFakeCaller()
		f.onJSON("call_bound_method", []atlasCard{{ID: "x", Title: "Some other card", ParentID: "y"}})
		if _, err := checkStickyBorderColorFlip(f); err == nil {
			t.Fatal("expected an error when \"Discovery workstream\" isn't in the seed")
		}
		for _, c := range f.calls {
			if c.tool == "call_bound_method" && strings.Contains(c.args["name"].(string), "CreateNote") {
				t.Fatal("CreateNote must not be called once the parent card lookup fails")
			}
		}
	})

	t.Run("border-color unchanged after selection is an error", func(t *testing.T) {
		f := newFakeCaller()
		f.onJSON("call_bound_method", seedCards)
		f.on("js_eval", func(map[string]any) (string, error) { return "chained", nil }) // repairAppDispatch after Cards
		f.onJSON("call_bound_method", map[string]any{"ID": "note-1"})
		f.on("js_eval", func(map[string]any) (string, error) { return "intact", nil }) // repairAppDispatch after CreateNote
		f.onJSON("js_eval", true)                                                      // pollJSEval: sticky rendered
		f.onJSON("js_eval", true)                                                      // waitForNodeStable: settled before the click
		f.onJSON("js_eval", stickySnapshot{BorderColor: "rgb(1,1,1)", BoxShadow: "none", Selected: false})
		f.on("js_eval", func(map[string]any) (string, error) { return "clear", nil }) // hit-test: nothing covers the sticky
		f.on("mouse_click", func(map[string]any) (string, error) { return "ok", nil })
		f.onJSON("js_eval", true) // poll: shift-click selected the sticky
		f.onJSON("js_eval", stickySnapshot{BorderColor: "rgb(1,1,1)", BoxShadow: "0 0 0 3px accent", Selected: true})
		if _, err := checkStickyBorderColorFlip(f); err == nil {
			t.Fatal("expected an error when border-color doesn't change")
		}
	})

	// Regression (goal 0263): an overlay left open by an earlier check
	// swallowed every pointer event, and the retry loop reported it as
	// a WebKit shift-click divergence. The hit-test must name the
	// covering element and refuse to click.
	t.Run("a covered sticky fails naming its coverer, never clicks", func(t *testing.T) {
		f := newFakeCaller()
		f.onJSON("call_bound_method", seedCards)
		f.on("js_eval", func(map[string]any) (string, error) { return "chained", nil })
		f.onJSON("call_bound_method", map[string]any{"ID": "note-1"})
		f.on("js_eval", func(map[string]any) (string, error) { return "intact", nil })
		f.onJSON("js_eval", true) // pollJSEval: sticky rendered
		f.onJSON("js_eval", true) // waitForNodeStable: settled
		f.onJSON("js_eval", stickySnapshot{BorderColor: "rgb(1,1,1)", BoxShadow: "none", Selected: false})
		f.on("js_eval", func(map[string]any) (string, error) { return "drawio-editor-frame", nil })
		_, err := checkStickyBorderColorFlip(f)
		if err == nil {
			t.Fatal("expected an error when something covers the sticky")
		}
		if !strings.Contains(err.Error(), "drawio-editor-frame") {
			t.Errorf("the failure must name the covering element, got %q", err)
		}
		for _, c := range f.calls {
			if c.tool == "mouse_click" {
				t.Fatal("must not click a sticky nothing can reach")
			}
		}
	})

	t.Run("already selected before the check ran is an error", func(t *testing.T) {
		f := newFakeCaller()
		f.onJSON("call_bound_method", seedCards)
		f.on("js_eval", func(map[string]any) (string, error) { return "chained", nil }) // repairAppDispatch after Cards
		f.onJSON("call_bound_method", map[string]any{"ID": "note-1"})
		f.on("js_eval", func(map[string]any) (string, error) { return "intact", nil }) // repairAppDispatch after CreateNote
		f.onJSON("js_eval", true)                                                      // pollJSEval: sticky rendered
		f.onJSON("js_eval", true)                                                      // waitForNodeStable: settled before the click
		f.onJSON("js_eval", stickySnapshot{BorderColor: "rgb(1,1,1)", BoxShadow: "0 0 0 3px accent", Selected: true})
		if _, err := checkStickyBorderColorFlip(f); err == nil {
			t.Fatal("expected an error for a sticky already selected before the check ran")
		}
		for _, c := range f.calls {
			if c.tool == "mouse_click" {
				t.Fatal("must not click once the board state is already dirty")
			}
		}
	})

	t.Run("a genuine bridge gap (unknown tool) propagates, never substituted", func(t *testing.T) {
		f := newFakeCaller()
		f.onError("call_bound_method", &bridgeGapError{tool: "call_bound_method", message: "unknown tool: call_bound_method"})
		_, err := checkStickyBorderColorFlip(f)
		var gap *bridgeGapError
		if !asBridgeGapError(err, &gap) {
			t.Fatalf("expected a *bridgeGapError, got %T: %v", err, err)
		}
	})
}

func TestCheckStickyClickToEdit(t *testing.T) {
	seedCards := []atlasCard{{ID: "card-1", Title: "Discovery workstream", ParentID: "space-1"}}

	t.Run("click-select, click-edit, type, cleanup", func(t *testing.T) {
		f := newFakeCaller()
		f.onJSON("call_bound_method", seedCards)                                                              // Cards
		f.on("js_eval", func(map[string]any) (string, error) { return "chained", nil })                       // repair after Cards
		f.onJSON("call_bound_method", map[string]any{"ID": "note-1"})                                         // CreateNote
		f.on("js_eval", func(map[string]any) (string, error) { return "intact", nil })                        // repair after CreateNote
		f.onJSON("js_eval", true)                                                                             // waitForNodeStable
		f.on("js_eval", func(map[string]any) (string, error) { return "r0: 620,200 99x68", nil })             // rect r0
		f.on("mouse_click", func(map[string]any) (string, error) { return "ok", nil })                        // select click
		f.on("js_eval", func(map[string]any) (string, error) { return "after-click1: 620,200 99x68", nil })   // rect r1
		f.on("js_eval", func(map[string]any) (string, error) { return "no-scrolled-elements", nil })          // scroll check
		f.onJSON("js_eval", true)                                                                             // poll: select click landed
		f.on("mouse_click", func(map[string]any) (string, error) { return "ok", nil })                        // commit click
		f.on("js_eval", func(map[string]any) (string, error) { return "after-click2: 620,200 300x110", nil }) // rect r2
		f.onJSON("js_eval", true)                                                                             // poll: editor opened
		f.onJSON("js_eval", true)                                                                             // poll: editor took focus
		f.on("keyboard_type", func(map[string]any) (string, error) { return "ok", nil })
		f.onJSON("js_eval", true)                                                         // poll: typed text landed
		f.on("keyboard_press", func(map[string]any) (string, error) { return "ok", nil }) // escape 1
		f.on("keyboard_press", func(map[string]any) (string, error) { return "ok", nil }) // escape 2
		f.onJSON("call_bound_method", nil)                                                // DeleteNote
		f.on("js_eval", func(map[string]any) (string, error) { return "intact", nil })    // repair after DeleteNote
		f.onJSON("js_eval", true)                                                         // poll: probe note gone

		detail, err := checkStickyClickToEdit(f)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if !strings.Contains(detail, "typing landed") {
			t.Errorf("got %q", detail)
		}
	})

	t.Run("select click failing propagates", func(t *testing.T) {
		f := newFakeCaller()
		f.onJSON("call_bound_method", seedCards)
		f.on("js_eval", func(map[string]any) (string, error) { return "chained", nil })
		f.onJSON("call_bound_method", map[string]any{"ID": "note-1"})
		f.on("js_eval", func(map[string]any) (string, error) { return "intact", nil })
		f.onJSON("js_eval", true) // waitForNodeStable
		f.on("js_eval", func(map[string]any) (string, error) { return "r0: gone", nil })
		f.onError("mouse_click", errors.New("no such element"))
		if _, err := checkStickyClickToEdit(f); err == nil {
			t.Fatal("expected the select click's error to propagate")
		}
	})

	t.Run("seeded card not found is an error, no note created", func(t *testing.T) {
		f := newFakeCaller()
		f.onJSON("call_bound_method", []atlasCard{{ID: "x", Title: "Some other card", ParentID: "y"}})
		if _, err := checkStickyClickToEdit(f); err == nil {
			t.Fatal("expected an error when \"Discovery workstream\" isn't in the seed")
		}
		for _, c := range f.calls {
			if c.tool == "call_bound_method" && strings.Contains(c.args["name"].(string), "CreateNote") {
				t.Fatal("CreateNote must not be called once the parent card lookup fails")
			}
		}
	})

	t.Run("a genuine bridge gap (unknown tool) propagates, never substituted", func(t *testing.T) {
		f := newFakeCaller()
		f.onError("call_bound_method", &bridgeGapError{tool: "call_bound_method", message: "unknown tool: call_bound_method"})
		_, err := checkStickyClickToEdit(f)
		var gap *bridgeGapError
		if !asBridgeGapError(err, &gap) {
			t.Fatalf("expected a *bridgeGapError, got %T: %v", err, err)
		}
	})
}
