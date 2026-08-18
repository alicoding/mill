package main

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"
)

// calledTool records one invocation against fakeCaller, for tests that
// assert on call order/arguments (e.g. that CreateNote's parentID comes
// from the right seeded card).
type calledTool struct {
	tool string
	args map[string]any
}

// fakeCaller is a scripted mcpCaller: each tool name has its own FIFO
// queue of responses, popped in call order -- lets a test give the
// same tool (js_eval, most often) a different answer on its 2nd/3rd
// call within one check, matching a real before/after read.
type fakeCaller struct {
	queues map[string][]func(args map[string]any) (string, error)
	calls  []calledTool
}

func newFakeCaller() *fakeCaller {
	return &fakeCaller{queues: map[string][]func(args map[string]any) (string, error){}}
}

func (f *fakeCaller) on(tool string, fn func(args map[string]any) (string, error)) {
	f.queues[tool] = append(f.queues[tool], fn)
}

func (f *fakeCaller) onJSON(tool string, v any) {
	b, err := json.Marshal(v)
	if err != nil {
		panic(err)
	}
	f.on(tool, func(map[string]any) (string, error) { return string(b), nil })
}

func (f *fakeCaller) onError(tool string, err error) {
	f.on(tool, func(map[string]any) (string, error) { return "", err })
}

func (f *fakeCaller) call(tool string, args map[string]any) (string, error) {
	f.calls = append(f.calls, calledTool{tool, args})
	q := f.queues[tool]
	if len(q) == 0 {
		return "", &bridgeGapError{tool: tool, message: "unknown tool: " + tool}
	}
	fn := q[0]
	f.queues[tool] = q[1:]
	return fn(args)
}

func (f *fakeCaller) callJSON(tool string, args map[string]any, out any) error {
	text, err := f.call(tool, args)
	if err != nil {
		return err
	}
	if out == nil {
		return nil
	}
	return json.Unmarshal([]byte(text), out)
}

func TestRegistry_Shape(t *testing.T) {
	seen := map[string]bool{}
	for _, chk := range registry {
		if chk.name == "" {
			t.Errorf("a registry entry has an empty name")
		}
		if seen[chk.name] {
			t.Errorf("duplicate registry entry name %q", chk.name)
		}
		seen[chk.name] = true
		if chk.reason == "" {
			t.Errorf("check %q has no reason -- registry discipline requires one", chk.name)
		}
		if chk.run == nil {
			t.Errorf("check %q has a nil run func", chk.name)
		}
	}
	if len(registry) == 0 {
		t.Fatal("registry is empty")
	}
}

func TestCheckIsolatedDataBadge(t *testing.T) {
	t.Run("badge present", func(t *testing.T) {
		f := newFakeCaller()
		f.onJSON("js_eval", true)
		detail, err := checkIsolatedDataBadge(f)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if detail != "badge visible" {
			t.Errorf("got %q", detail)
		}
	})

	t.Run("badge missing", func(t *testing.T) {
		prev := badgePollTimeout
		badgePollTimeout = 50 * time.Millisecond
		defer func() { badgePollTimeout = prev }()
		f := newFakeCaller()
		f.onJSON("js_eval", false)
		if _, err := checkIsolatedDataBadge(f); err == nil {
			t.Fatal("expected an error when the badge is missing")
		}
	})

	t.Run("scopes the query to the main window", func(t *testing.T) {
		f := newFakeCaller()
		f.onJSON("js_eval", true)
		if _, err := checkIsolatedDataBadge(f); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if got := f.calls[0].args["window"]; got != mainWindowName {
			t.Errorf("js_eval window arg = %v, want %q", got, mainWindowName)
		}
	})
}

// realWindows is the app's true three-window shape (ADR-0033) as
// app_info reports it.
func realWindows() []map[string]any {
	return []map[string]any{
		{"name": "main", "visible": true},
		{"name": "quickpanel", "visible": false},
		{"name": "approvalprompt", "visible": false},
	}
}

func TestCheckAppInfo(t *testing.T) {
	t.Run("darwin, real three-window shape", func(t *testing.T) {
		f := newFakeCaller()
		f.onJSON("app_info", map[string]any{"os": "darwin", "windows": realWindows()})
		detail, err := checkAppInfo(f)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if !strings.Contains(detail, "darwin") {
			t.Errorf("got %q", detail)
		}
	})

	t.Run("wrong os", func(t *testing.T) {
		f := newFakeCaller()
		f.onJSON("app_info", map[string]any{"os": "linux", "windows": realWindows()})
		if _, err := checkAppInfo(f); err == nil {
			t.Fatal("expected an error for a non-darwin os")
		}
	})

	t.Run("missing expected window", func(t *testing.T) {
		f := newFakeCaller()
		f.onJSON("app_info", map[string]any{"os": "darwin", "windows": realWindows()[:2]})
		if _, err := checkAppInfo(f); err == nil {
			t.Fatal("expected an error when approvalprompt is missing")
		}
	})

	t.Run("unexpected extra window", func(t *testing.T) {
		f := newFakeCaller()
		f.onJSON("app_info", map[string]any{"os": "darwin", "windows": append(realWindows(), map[string]any{"name": "mystery", "visible": true})})
		if _, err := checkAppInfo(f); err == nil {
			t.Fatal("expected an error for an unexpected window name")
		}
	})

	t.Run("main window hidden", func(t *testing.T) {
		f := newFakeCaller()
		windows := realWindows()
		windows[0]["visible"] = false
		f.onJSON("app_info", map[string]any{"os": "darwin", "windows": windows})
		if _, err := checkAppInfo(f); err == nil {
			t.Fatal("expected an error when the main window is not visible")
		}
	})
}

func TestPollJSEval(t *testing.T) {
	t.Run("returns nil as soon as the condition is true", func(t *testing.T) {
		f := newFakeCaller()
		f.onJSON("js_eval", true)
		if err := pollJSEval(f, "return true;", time.Second); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
	})

	t.Run("retries until true", func(t *testing.T) {
		f := newFakeCaller()
		f.onJSON("js_eval", false)
		f.onJSON("js_eval", false)
		f.onJSON("js_eval", true)
		start := time.Now()
		if err := pollJSEval(f, "...", time.Second); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if time.Since(start) < 500*time.Millisecond {
			t.Error("expected pollJSEval to have actually retried (2x300ms sleep) before succeeding")
		}
	})

	t.Run("times out when the condition never becomes true", func(t *testing.T) {
		f := newFakeCaller()
		for range 3 {
			f.onJSON("js_eval", false)
		}
		if err := pollJSEval(f, "...", 50*time.Millisecond); err == nil {
			t.Fatal("expected a timeout error")
		}
	})
}

func TestCheckAtlasBoardRenders(t *testing.T) {
	t.Run("nav click then board renders", func(t *testing.T) {
		f := newFakeCaller()
		f.onJSON("js_eval", map[string]any{"clicked": true, "tag": "A"})
		f.onJSON("js_eval", true)
		detail, err := checkAtlasBoardRenders(f)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if !strings.Contains(detail, "atlas-board") {
			t.Errorf("got %q", detail)
		}
	})

	t.Run("nav entry not found propagates the error", func(t *testing.T) {
		f := newFakeCaller()
		f.onError("js_eval", errors.New("Atlas nav entry not found among 3 candidates"))
		if _, err := checkAtlasBoardRenders(f); err == nil {
			t.Fatal("expected an error when the Atlas nav entry can't be found")
		}
	})
}

func TestCheckNoteCardCommit(t *testing.T) {
	t.Run("select click, commit click, escape ladder", func(t *testing.T) {
		f := newFakeCaller()
		f.onJSON("js_eval", true) // poll: node position stable
		f.onJSON("js_eval", true) // poll: wrapper selected
		f.onJSON("js_eval", true) // poll: page header visible
		f.onJSON("js_eval", true) // poll: board unselected again
		f.on("mouse_click", func(map[string]any) (string, error) { return "ok", nil })
		f.on("mouse_click", func(map[string]any) (string, error) { return "ok", nil })
		f.on("keyboard_press", func(map[string]any) (string, error) { return "ok", nil })
		f.on("keyboard_press", func(map[string]any) (string, error) { return "ok", nil })
		detail, err := checkNoteCardCommit(f)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if !strings.Contains(detail, "click-commit") {
			t.Errorf("got %q", detail)
		}
	})

	t.Run("select click failing propagates", func(t *testing.T) {
		f := newFakeCaller()
		f.onJSON("js_eval", true) // poll: node position stable
		f.onError("mouse_click", errors.New("no such element"))
		if _, err := checkNoteCardCommit(f); err == nil {
			t.Fatal("expected the select click's error to propagate")
		}
	})

	t.Run("commit click failing propagates", func(t *testing.T) {
		f := newFakeCaller()
		f.on("mouse_click", func(map[string]any) (string, error) { return "ok", nil })
		f.onJSON("js_eval", true) // poll: wrapper selected
		f.onError("mouse_click", errors.New("gone"))
		if _, err := checkNoteCardCommit(f); err == nil {
			t.Fatal("expected the commit click's error to propagate")
		}
	})
}

func TestCheckNoteCardSelectionRing(t *testing.T) {
	t.Run("box-shadow none -> non-none on shift-click select", func(t *testing.T) {
		f := newFakeCaller()
		f.onJSON("js_eval", true) // poll: node position stable
		f.onJSON("js_eval", ringSnapshot{BoxShadow: "none", Selected: false})
		f.on("mouse_click", func(map[string]any) (string, error) { return "ok", nil })
		f.onJSON("js_eval", ringSnapshot{BoxShadow: "0 0 0 2px accent", Selected: true})
		detail, err := checkNoteCardSelectionRing(f)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if !strings.Contains(detail, "none ->") {
			t.Errorf("got %q", detail)
		}
	})

	t.Run("already selected before the check ran is an error", func(t *testing.T) {
		f := newFakeCaller()
		f.onJSON("js_eval", true) // poll: node position stable
		f.onJSON("js_eval", ringSnapshot{BoxShadow: "none", Selected: true})
		if _, err := checkNoteCardSelectionRing(f); err == nil {
			t.Fatal("expected an error for a pre-selected card")
		}
	})

	t.Run("shift-click that fails to select is an error", func(t *testing.T) {
		f := newFakeCaller()
		f.onJSON("js_eval", true) // poll: node position stable
		f.onJSON("js_eval", ringSnapshot{BoxShadow: "none", Selected: false})
		f.on("mouse_click", func(map[string]any) (string, error) { return "ok", nil })
		f.onJSON("js_eval", ringSnapshot{BoxShadow: "none", Selected: false})
		if _, err := checkNoteCardSelectionRing(f); err == nil {
			t.Fatal("expected an error when shift-click never selects the card")
		}
	})

	t.Run("ring never renders after selection is an error", func(t *testing.T) {
		f := newFakeCaller()
		f.onJSON("js_eval", true) // poll: node position stable
		f.onJSON("js_eval", ringSnapshot{BoxShadow: "none", Selected: false})
		f.on("mouse_click", func(map[string]any) (string, error) { return "ok", nil })
		f.onJSON("js_eval", ringSnapshot{BoxShadow: "none", Selected: true})
		if _, err := checkNoteCardSelectionRing(f); err == nil {
			t.Fatal("expected an error when box-shadow stays none after selection")
		}
	})
}

func TestCheckStickyBorderColorFlip(t *testing.T) {
	seedCards := []atlasCard{{ID: "card-1", Title: "Getting started", ParentID: "space-1"}}

	t.Run("border-color and ring both flip on selection", func(t *testing.T) {
		f := newFakeCaller()
		f.onJSON("call_bound_method", seedCards)
		f.on("js_eval", func(map[string]any) (string, error) { return "chained", nil }) // repairAppDispatch after Cards
		f.onJSON("call_bound_method", map[string]any{"ID": "note-1"})
		f.on("js_eval", func(map[string]any) (string, error) { return "intact", nil }) // repairAppDispatch after CreateNote
		f.onJSON("js_eval", true) // pollJSEval: sticky rendered
		f.onJSON("js_eval", stickySnapshot{BorderColor: "rgb(1,1,1)", BoxShadow: "none"})
		f.on("mouse_click", func(map[string]any) (string, error) { return "ok", nil })
		f.onJSON("js_eval", stickySnapshot{BorderColor: "rgb(9,9,9)", BoxShadow: "0 0 0 3px accent"})

		detail, err := checkStickyBorderColorFlip(f)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if !strings.Contains(detail, "rgb(1,1,1) -> rgb(9,9,9)") {
			t.Errorf("got %q", detail)
		}

		// The note must nest under "Getting started"'s own ParentID
		// (the auto-entered board level), not under Getting started's
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
		}
		args, _ := createCall.args["args"].([]any)
		if len(args) != 3 || args[2] != "space-1" {
			t.Errorf("expected CreateNote's parentID to be space-1 (Getting started's own ParentID), got args=%v", args)
		}
	})

	t.Run("seeded card not found is an error, no note created", func(t *testing.T) {
		f := newFakeCaller()
		f.onJSON("call_bound_method", []atlasCard{{ID: "x", Title: "Some other card", ParentID: "y"}})
		if _, err := checkStickyBorderColorFlip(f); err == nil {
			t.Fatal("expected an error when \"Getting started\" isn't in the seed")
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
		f.onJSON("call_bound_method", map[string]any{"ID": "note-1"})
		f.onJSON("js_eval", true)
		f.onJSON("js_eval", stickySnapshot{BorderColor: "rgb(1,1,1)", BoxShadow: "none"})
		f.on("mouse_click", func(map[string]any) (string, error) { return "ok", nil })
		f.onJSON("js_eval", stickySnapshot{BorderColor: "rgb(1,1,1)", BoxShadow: "0 0 0 3px accent"})
		if _, err := checkStickyBorderColorFlip(f); err == nil {
			t.Fatal("expected an error when border-color doesn't change")
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
