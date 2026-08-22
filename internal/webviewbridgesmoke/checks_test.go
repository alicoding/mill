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
		f.onJSON("js_eval", true) // poll: page header gone (after escape 1)
		f.onJSON("js_eval", true) // poll: board unselected (after escape 2)
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

	// Regression: this test previously stubbed only one js_eval response
	// before the commit-click error, which the SELECT loop's own
	// waitForNodeStable consumed -- its follow-up "is it selected" poll
	// then found the queue empty and burned its full timeout budget
	// (~23s) before the commit click was ever reached, passing for the
	// wrong reason. Every step through the select click is now stubbed
	// explicitly so the commit click's error is what actually fails it.
	t.Run("commit click failing propagates", func(t *testing.T) {
		f := newFakeCaller()
		f.onJSON("js_eval", true)                                                      // poll: node position stable
		f.on("mouse_click", func(map[string]any) (string, error) { return "ok", nil }) // select click
		f.onJSON("js_eval", true)                                                      // poll: wrapper selected
		f.onError("mouse_click", errors.New("gone"))                                   // commit click
		if _, err := checkNoteCardCommit(f); err == nil {
			t.Fatal("expected the commit click's error to propagate")
		}
	})

	// Regression: the two Escape presses used to fire back-to-back with
	// only one combined poll after both, which raced Primer Dialog's
	// async close (a React state update, not synchronous with the
	// keypress) -- a still-mounted Dialog could swallow the second
	// Escape too, leaving the selection never cleared. Pins that a poll
	// for the page closing now sits BETWEEN the two keyboard_press
	// calls, so the second Escape is never sent until the first one's
	// close is confirmed.
	t.Run("second escape only fires after the first escape's close is confirmed", func(t *testing.T) {
		f := newFakeCaller()
		f.onJSON("js_eval", true) // poll: node position stable
		f.onJSON("js_eval", true) // poll: wrapper selected
		f.onJSON("js_eval", true) // poll: page header visible
		f.onJSON("js_eval", true) // poll: page header gone (after escape 1)
		f.onJSON("js_eval", true) // poll: board unselected (after escape 2)
		f.on("mouse_click", func(map[string]any) (string, error) { return "ok", nil })
		f.on("mouse_click", func(map[string]any) (string, error) { return "ok", nil })
		f.on("keyboard_press", func(map[string]any) (string, error) { return "ok", nil })
		f.on("keyboard_press", func(map[string]any) (string, error) { return "ok", nil })
		if _, err := checkNoteCardCommit(f); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		var escapeIdx, pollBetween []int
		for i, call := range f.calls {
			if call.tool == "keyboard_press" {
				escapeIdx = append(escapeIdx, i)
			}
		}
		if len(escapeIdx) != 2 {
			t.Fatalf("expected exactly 2 keyboard_press calls, got %d", len(escapeIdx))
		}
		for i := escapeIdx[0] + 1; i < escapeIdx[1]; i++ {
			if f.calls[i].tool == "js_eval" {
				pollBetween = append(pollBetween, i)
			}
		}
		if len(pollBetween) == 0 {
			t.Fatal("expected at least one js_eval poll between the two Escape presses -- they must not fire back-to-back")
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

// TestCheckStickyBorderColorFlip and TestCheckStickyClickToEdit live in
// checks_sticky_test.go (file-loc-limit split, mirroring checks_sticky.go).
