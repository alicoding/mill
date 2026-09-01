package main

import (
	"fmt"
	"time"
)

// check is one named, self-contained verification driven entirely over
// the real MCP bridge against the real desktop window -- never a
// Playwright/Chromium stand-in. Each entry's reason states specifically
// what a Chromium-only suite cannot see that this check can, per the
// manual-only-registry discipline (.claude/rules/testing.md) this
// mirrors: explicit membership with reasons, additions deliberate.
type check struct {
	name   string
	reason string
	run    func(c mcpCaller) (string, error)
}

// mainWindowName matches main.go's explicit window name. Every
// page-directed bridge tool (js_eval, mouse_click, keyboard_press)
// defaults to "the focused window, or the first window" -- with three
// live windows (main + quickpanel + approvalprompt, ADR-0033) that
// default is ambiguous, so every call scopes itself here explicitly.
const mainWindowName = "main"

// withWindow returns args with the main-window scope added -- checks
// never mutate a shared map, each call site builds its own.
func withWindow(args map[string]any) map[string]any {
	args["window"] = mainWindowName
	return args
}

// badgePollTimeout is a var so the negative-path unit test can shrink
// it instead of waiting out the real deadline.
var badgePollTimeout = 10 * time.Second

// The bridge's call_bound_method tool runs
// `await import('/wails/runtime.js')` inside the target window (its
// own implementation, mcp_tools_enabled.go). That import executes a
// SECOND runtime instance which re-registers
// window._wails.dispatchWailsEvent, permanently orphaning the app
// bundle's own event listeners -- from that moment every Go-emitted
// event (mill-data-changed live-sync, the footer clock's time tick)
// silently stops reaching the app. Reproduced deterministically: the
// clock freezes at the exact second of the first call_bound_method.
// Until fixed upstream, the harness repairs it: capture the app's
// dispatcher before any bound call, and after each bound call chain
// the stolen slot back so BOTH instances receive every event.

// captureAppDispatch stashes the app bundle's live dispatcher. Must
// run before the first call_bound_method in the window.
func captureAppDispatch(c mcpCaller) error {
	return pollJSEval(c, `window.__millAppDispatch = window.__millAppDispatch || (window._wails && window._wails.dispatchWailsEvent);
		return !!window.__millAppDispatch;`, 10*time.Second)
}

// repairAppDispatch re-chains the app's captured dispatcher behind
// whatever call_bound_method's runtime import installed. Idempotent.
func repairAppDispatch(c mcpCaller) error {
	// c.call, not callJSON: the bridge returns a bare string result
	// unquoted, which is not valid JSON.
	status, err := c.call("js_eval", withWindow(map[string]any{
		"js": `const w = window._wails;
			if (!window.__millAppDispatch) return "no-capture";
			if (w.dispatchWailsEvent !== window.__millAppDispatch && !w.__millChained) {
				const stolen = w.dispatchWailsEvent;
				w.dispatchWailsEvent = function (e) { try { stolen(e) } catch (err) { /* second instance only */ } window.__millAppDispatch(e); };
				w.__millChained = true;
				return "chained";
			}
			return "intact";`,
	}))
	if err != nil {
		return err
	}
	if status == "no-capture" {
		return fmt.Errorf("repairAppDispatch ran without a prior captureAppDispatch -- the app's event bus may be dead")
	}
	return nil
}

// callBoundJSON wraps call_bound_method with the dispatcher repair
// above -- every bound call in this package must go through it.
func callBoundJSON(c mcpCaller, name string, args []any, out any) error {
	if err := c.callJSON("call_bound_method", map[string]any{"name": name, "args": args}, out); err != nil {
		return err
	}
	return repairAppDispatch(c)
}

var registry = []check{
	{
		name:   "isolated-data-badge",
		reason: "confirms the real desktop window is serving throwaway MILL_SETTINGS_PATH/MILL_EXECUTION_DB_PATH, never real user data, before any further check touches it (mirrors frontend/e2e/fixtures/server.ts's own per-server guard).",
		run:    checkIsolatedDataBadge,
	},
	{
		name:   "app-info-window-sane",
		reason: "the real Wails process reports the app's true window set on darwin (main + quickpanel + approvalprompt + traypanel, ADR-0033 + goal 0189) -- proves a genuine desktop process booted with its real window set, not just that a binary exists.",
		run:    checkAppInfo,
	},
	{
		name:   "atlas-board-renders",
		reason: "the real WKWebView actually mounts the SPA and renders the Atlas board -- a page that never finishes loading in the real engine would pass a Chromium-only suite untouched.",
		run:    checkAtlasBoardRenders,
	},
	{
		name:   "note-card-commit-interaction",
		reason: "a real WKWebView pointer event round-trips into React state -- click-select then click-commit (the goal 0102 model: two plain clicks open a leaf's page) is Atlas's most basic interaction, gates everything after it.",
		run:    checkNoteCardCommit,
	},
	{
		name:   "note-card-selection-ring",
		reason: "the burned class of bug this goal exists for: the selected note-card's box-shadow ring (on the React Flow node WRAPPER -- .react-flow__node-atlas-note.selected -- where PR #227 moved it out of Primer's [role=button] focus-reset reach) rendered none in real WebKit while Chromium rendered it fine.",
		run:    checkNoteCardSelectionRing,
	},
	{
		name:   "sticky-click-to-edit",
		reason: "owner-reported on the installed beta.724 (WebKit): click-to-edit a sticky got jumpy and the editor never opened; Chromium layers all pass -- the exact engine-parity class this registry exists for.",
		run:    checkStickyClickToEdit,
	},
	{
		name:   "drawio-editor-layout",
		reason: "owner-reported on the installed build (goal 0259): the embedded drawio editor's bottom page-tab bar sat outside the visible window with no scroll to it, and the diagram's resize frame seemed absent -- both measure CORRECT in Chromium at harness sizes, the exact engine/window-divergence class this registry exists for. Asserts, in the real WKWebView: band-click selection produces the full resize-handle set, and the editor dialog, its iframe, and the two-page tab bar all sit inside the real window.",
		run:    checkDrawioEditorLayout,
	},
	{
		name:   "pdf-find-in-viewer",
		reason: "owner-reported (goal 0271): pdf.js find returns no matches in the installed app while the same document searches fine outside Mill -- the full findbar pipeline passes in Chromium AND Playwright WebKit against server mode, so the real WKWebView is the one engine left uncovered; drives the vendored viewer's own find controller over a known-text fixture and asserts the match count.",
		run:    checkPdfFindInViewer,
	},
	{
		name:   "sticky-border-color-flip",
		reason: "the second burned class: a selected sticky note's border-color flip to the accent token (AtlasStickyNode.module.css) -- a real Note, created live via AtlasService.CreateNote so the check exercises the same call_bound_method path an agent driving Mill would use.",
		run:    checkStickyBorderColorFlip,
	},
}

func checkIsolatedDataBadge(c mcpCaller) (string, error) {
	// Polled, not one-shot: the badge renders only after the frontend's
	// async IsIsolatedData RPC resolves, which races the bridge
	// becoming reachable.
	if err := pollJSEval(c, `return !!document.querySelector('[data-testid="isolated-data-badge"]');`, badgePollTimeout); err != nil {
		return "", fmt.Errorf("isolated-data-badge not present -- refusing to trust this window's data isolation: %w", err)
	}
	return "badge visible", nil
}

func checkAppInfo(c mcpCaller) (string, error) {
	var info struct {
		OS      string `json:"os"`
		Windows []struct {
			Name    string `json:"name"`
			Visible bool   `json:"visible"`
		} `json:"windows"`
	}
	if err := c.callJSON("app_info", map[string]any{}, &info); err != nil {
		return "", err
	}
	if info.OS != "darwin" {
		return "", fmt.Errorf("expected os darwin, got %q", info.OS)
	}
	// The app's real window set (ADR-0033, plus the menu-bar panel's
	// own attachable window -- goal 0189's SystemTray.AttachWindow):
	// the named main window plus the three auxiliary windows. Asserted
	// by name, not count, so a missing or unexpected window is named
	// in the failure.
	want := map[string]bool{mainWindowName: false, "quickpanel": false, "approvalprompt": false, "traypanel": false}
	mainVisible := false
	for _, w := range info.Windows {
		seen, expected := want[w.Name]
		if !expected {
			return "", fmt.Errorf("unexpected window %q -- the registry's window model is stale", w.Name)
		}
		if seen {
			return "", fmt.Errorf("duplicate window %q", w.Name)
		}
		want[w.Name] = true
		if w.Name == mainWindowName {
			mainVisible = w.Visible
		}
	}
	for name, seen := range want {
		if !seen {
			return "", fmt.Errorf("expected window %q not reported", name)
		}
	}
	if !mainVisible {
		return "", fmt.Errorf("main window reported not visible")
	}
	return fmt.Sprintf("os=%s windows=main+quickpanel+approvalprompt+traypanel, main visible", info.OS), nil
}

// pollJSEval retries a boolean-returning js_eval snippet until it's
// true or the deadline passes -- the real webview's page load and
// React's own render pass are both async relative to the MCP HTTP
// server becoming reachable.
func pollJSEval(c mcpCaller, js string, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	var lastErr error
	for time.Now().Before(deadline) {
		var ok bool
		if err := c.callJSON("js_eval", withWindow(map[string]any{"js": js}), &ok); err != nil {
			lastErr = err
		} else if ok {
			return nil
		}
		time.Sleep(300 * time.Millisecond)
	}
	if lastErr != nil {
		return fmt.Errorf("timed out polling: %w", lastErr)
	}
	return fmt.Errorf("timed out polling (condition never became true)")
}

func checkAtlasBoardRenders(c mcpCaller) (string, error) {
	var nav struct {
		Clicked bool   `json:"clicked"`
		Tag     string `json:"tag"`
	}
	if err := c.callJSON("js_eval", withWindow(map[string]any{
		"js": `const candidates = [...document.querySelectorAll('a,button,[role="link"],[role="button"]')];
			const link = candidates.find(el => (el.textContent||'').trim() === 'Atlas' || el.getAttribute('aria-label') === 'Atlas');
			if (!link) throw new Error('Atlas nav entry not found among ' + candidates.length + ' candidates');
			link.click();
			return { clicked: true, tag: link.tagName };`,
	}), &nav); err != nil {
		return "", err
	}
	if err := pollJSEval(c, `return !!document.querySelector('[data-testid="atlas-board"]');`, 10*time.Second); err != nil {
		return "", fmt.Errorf("atlas board never rendered after clicking nav (%s): %w", nav.Tag, err)
	}
	return "atlas-board rendered after nav click", nil
}

var stableSeq int

// waitForNodeStable polls until selector's bounding rect stops moving
// across two consecutive samples -- the board's fitView animation
// after navigation invalidates any position measured mid-flight, the
// same stale-coordinate class the Playwright suite's own
// clickFrameGutter helper exists for. A click dispatched before this
// settles lands where the card WAS and selects nothing.
func waitForNodeStable(c mcpCaller, selector string) error {
	// Fresh slot per invocation: a leftover key from an earlier check
	// could otherwise satisfy the very first sample.
	stableSeq++
	slot := fmt.Sprintf("__millStablePos%d", stableSeq)
	return pollJSEval(c, fmt.Sprintf(`const el = document.querySelector(%q);
		if (!el) return false;
		const r = el.getBoundingClientRect();
		const key = Math.round(r.x) + ':' + Math.round(r.y);
		if (window[%q] === key) { return true; }
		window[%q] = key;
		return false;`, selector, slot, slot), 10*time.Second)
}

// checkNoteCardCommit drives the goal 0102 click model end to end:
// plain click selects (React Flow needs the full pointer sequence, so
// mouse_click, never a js_eval .click()), a second click on the
// now-sole-selected card commits it (a leaf opens its page). Cleanup
// walks the Escape ladder twice -- close page, then clear selection --
// so the ring check that follows starts from an unselected board.
func checkNoteCardCommit(c mcpCaller) (string, error) {
	selector := `[data-testid="atlas-note-card"]`
	// Full-gesture retry (the e2e suite's own converged pattern): this
	// check runs FIRST after the board renders, and on a slow CI
	// runner the fitView camera can hitch through the stability
	// sampler -- a click computed against pre-settle coordinates then
	// misses the card entirely. Re-running stability + click retries
	// the SYNTHESIS; a genuinely broken click model still fails every
	// attempt (CI-only 5/6 failures, local 6/6 green, every red run
	// naming this one check).
	selectedJS := `const card = document.querySelector('[data-testid="atlas-note-card"]');
		return !!card && !!card.closest('.react-flow__node.selected');`
	var lastErr error
	for attempt := 0; attempt < 3; attempt++ {
		if err := waitForNodeStable(c, selector); err != nil {
			lastErr = fmt.Errorf("board never settled before the select click: %w", err)
			continue
		}
		if _, err := c.call("mouse_click", withWindow(map[string]any{"selector": selector})); err != nil {
			return "", fmt.Errorf("select click: %w", err)
		}
		if err := pollJSEval(c, selectedJS, 3*time.Second); err != nil {
			lastErr = fmt.Errorf("first click never selected the card: %w", err)
			continue
		}
		lastErr = nil
		break
	}
	if lastErr != nil {
		return "", fmt.Errorf("after 3 attempts: %w", lastErr)
	}
	// The commit click gets the same treatment: a miss lands on the
	// pane and deselects; the next attempt's click re-selects, and the
	// one after commits -- self-healing inside the attempt budget.
	lastErr = nil
	for attempt := 0; attempt < 3; attempt++ {
		if _, err := c.call("mouse_click", withWindow(map[string]any{"selector": selector})); err != nil {
			return "", fmt.Errorf("commit click: %w", err)
		}
		if err := pollJSEval(c, `return !!document.querySelector('[data-testid="atlas-page-header"]');`, 3*time.Second); err != nil {
			lastErr = fmt.Errorf("second click on the selected card never opened its page: %w", err)
			continue
		}
		lastErr = nil
		break
	}
	if lastErr != nil {
		return "", fmt.Errorf("after 3 attempts: %w", lastErr)
	}
	// Each Escape settles before the next fires: Primer's Dialog closes
	// via a React state update, not synchronously with the keypress, so
	// firing the second Escape before the first one's unmount has
	// committed lets the still-mounted Dialog swallow it too -- the
	// board's own Escape-ladder listener (useAtlasSelectionTray, gated
	// on no Dialog holding focus) is then never reached and the
	// selection never clears.
	if _, err := c.call("keyboard_press", withWindow(map[string]any{"key": "Escape"})); err != nil {
		return "", fmt.Errorf("escape 1: %w", err)
	}
	if err := pollJSEval(c, `return !document.querySelector('[data-testid="atlas-page-header"]');`, 5*time.Second); err != nil {
		return "", fmt.Errorf("first escape never closed the page: %w", err)
	}
	if _, err := c.call("keyboard_press", withWindow(map[string]any{"key": "Escape"})); err != nil {
		return "", fmt.Errorf("escape 2: %w", err)
	}
	if err := pollJSEval(c, `return !document.querySelector('.react-flow__node.selected');`, 5*time.Second); err != nil {
		return "", fmt.Errorf("second escape never cleared the selection: %w", err)
	}
	return "click-select then click-commit opened the page; Escape ladder restored the board", nil
}

type ringSnapshot struct {
	BoxShadow string `json:"boxShadow"`
	Selected  bool   `json:"selected"`
}

// The ring is measured on the React Flow node WRAPPER, not the inner
// element: PR #227 moved every selection ring there so Primer's
// [role="button"] focus reset (which outranks any inner-element rule
// on the just-clicked, focused node) can never zero it.
func readRing(c mcpCaller, selector string) (ringSnapshot, error) {
	var snap ringSnapshot
	err := c.callJSON("js_eval", withWindow(map[string]any{
		"js": fmt.Sprintf(`const el = document.querySelectorAll(%q)[0];
			if (!el) throw new Error('element not found: %s');
			const wrapper = el.closest('.react-flow__node');
			if (!wrapper) throw new Error('no react-flow node wrapper above: %s');
			const style = getComputedStyle(wrapper);
			return { boxShadow: style.boxShadow, selected: wrapper.classList.contains('selected') };`, selector, selector, selector),
	}), &snap)
	return snap, err
}

func checkNoteCardSelectionRing(c mcpCaller) (string, error) {
	selector := `[data-testid="atlas-note-card"]`
	if err := waitForNodeStable(c, selector); err != nil {
		return "", fmt.Errorf("board never settled before the ring check: %w", err)
	}
	before, err := readRing(c, selector)
	if err != nil {
		return "", err
	}
	if before.Selected {
		return "", fmt.Errorf("card already selected before the check ran -- board state isn't clean")
	}
	// The real mouse_click tool dispatches the full pointer/mouse event
	// sequence (per the tool's own description) -- unlike a js_eval
	// .click(), this is what React Flow's own selection handling
	// (goal 0092's shift-click toggle, tied to real pointerdown) needs.
	if _, err := c.call("mouse_click", withWindow(map[string]any{
		"selector":  selector,
		"modifiers": []string{"shift"},
	})); err != nil {
		return "", err
	}
	after, err := readRing(c, selector)
	if err != nil {
		return "", err
	}
	if !after.Selected {
		return "", fmt.Errorf("shift-click did not select the card")
	}
	if before.BoxShadow != "none" {
		return "", fmt.Errorf("expected no ring before selection, got box-shadow %q", before.BoxShadow)
	}
	if after.BoxShadow == "none" {
		return "", fmt.Errorf("selection ring did not render: box-shadow is none after shift-click select")
	}
	return fmt.Sprintf("box-shadow none -> %s on select", after.BoxShadow), nil
}
