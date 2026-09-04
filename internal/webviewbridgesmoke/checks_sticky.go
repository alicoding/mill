package main

import (
	"fmt"
	"time"
)

// atlasCard mirrors internal/domain/atlas.Card's JSON shape closely
// enough to read Title/ID/ParentID off AtlasService.Cards() -- the
// note-nesting parent this check needs is whatever card the seeded
// "Discovery workstream" card itself lives under, not a hardcoded ID.
type atlasCard struct {
	ID       string `json:"ID"`
	Title    string `json:"Title"`
	ParentID string `json:"ParentID"`
}

// gettingStartedParentID resolves the board level both sticky checks
// place their probe note at: whatever card the seeded "Discovery
// workstream" card itself lives under, never a hardcoded ID.
func gettingStartedParentID(c mcpCaller) (string, error) {
	var cards []atlasCard
	if err := callBoundJSON(c, "github.com/alicoding/mill/internal/services/atlassvc.AtlasService.Cards", []any{}, &cards); err != nil {
		return "", err
	}
	for _, card := range cards {
		if card.Title == "Discovery workstream" {
			return card.ParentID, nil
		}
	}
	return "", fmt.Errorf("seeded card \"Discovery workstream\" not found -- can't place the check's sticky note at the right board level")
}

func checkStickyBorderColorFlip(c mcpCaller) (string, error) {
	parentID, err := gettingStartedParentID(c)
	if err != nil {
		return "", err
	}

	var note struct {
		ID string `json:"ID"`
	}
	if err := callBoundJSON(c, "github.com/alicoding/mill/internal/services/atlassvc.AtlasService.CreateNote",
		[]any{"webview-bridge-smoke check", map[string]any{"X": 340, "Y": 340}, parentID}, &note); err != nil {
		return "", err
	}

	selector := `[data-testid="atlas-sticky-note"]`
	if err := pollJSEval(c, fmt.Sprintf(`return !!document.querySelector('%s');`, selector), 10*time.Second); err != nil {
		return "", fmt.Errorf("sticky note never rendered after AtlasService.CreateNote: %w", err)
	}
	if err := waitForNodeStable(c, selector); err != nil {
		return "", fmt.Errorf("board never settled before the border-flip click: %w", err)
	}

	before, err := readStickyStyle(c, selector)
	if err != nil {
		return "", err
	}
	if before.Selected {
		return "", fmt.Errorf("sticky already selected before the check ran -- board state isn't clean")
	}

	// Precondition, not a retry: hit-test the sticky's own centre
	// before the gesture. Anything a previous check left on top of the
	// board -- a modal, an overlay -- swallows every pointer event
	// silently, and a retry loop then reports the miss as an engine
	// divergence instead of the state leak it is. Name the covering
	// element and fail immediately.
	cover, err := c.call("js_eval", withWindow(map[string]any{
		"js": fmt.Sprintf(`const el = document.querySelector('%s');
			if (!el) return 'the sticky is gone';
			const r = el.getBoundingClientRect();
			const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
			if (!top) return 'nothing at all';
			if (top.closest('%s')) return 'clear';
			return top.getAttribute('data-testid') || top.getAttribute('data-component') || top.tagName.toLowerCase();`, selector, selector),
	}))
	if err != nil {
		return "", err
	}
	if cover != "clear" {
		return "", fmt.Errorf("the sticky's own centre is covered by %s -- no click can reach it", cover)
	}

	if _, err := c.call("mouse_click", withWindow(map[string]any{
		"selector":  selector,
		"modifiers": []string{"shift"},
	})); err != nil {
		return "", err
	}
	if err := pollJSEval(c, fmt.Sprintf(`const el = document.querySelector('%s');
		return !!el && !!el.closest('.react-flow__node.selected');`, selector), 3*time.Second); err != nil {
		return "", fmt.Errorf("shift-click never selected the sticky: %w", err)
	}

	after, err := readStickyStyle(c, selector)
	if err != nil {
		return "", err
	}
	if before.BorderColor == after.BorderColor {
		return "", fmt.Errorf("border-color did not flip on selection: stayed %q", before.BorderColor)
	}
	if after.BoxShadow == "none" {
		return "", fmt.Errorf("sticky selection ring did not render: wrapper box-shadow is none after shift-click select")
	}
	return fmt.Sprintf("border-color %s -> %s, box-shadow none -> %s", before.BorderColor, after.BorderColor, after.BoxShadow), nil
}

type stickySnapshot struct {
	BorderColor string `json:"borderColor"`
	BoxShadow   string `json:"boxShadow"`
	Selected    bool   `json:"selected"`
}

// Border-color reads from the inner sticky element (the accent flip
// stayed there); box-shadow and the selected flag read from the
// wrapper, same reasoning as readRing above.
func readStickyStyle(c mcpCaller, selector string) (stickySnapshot, error) {
	var snap stickySnapshot
	err := c.callJSON("js_eval", withWindow(map[string]any{
		"js": fmt.Sprintf(`const el = document.querySelector(%q);
			if (!el) throw new Error('element not found: %s');
			const wrapper = el.closest('.react-flow__node');
			if (!wrapper) throw new Error('no react-flow node wrapper above: %s');
			return { borderColor: getComputedStyle(el).borderColor, boxShadow: getComputedStyle(wrapper).boxShadow, selected: wrapper.classList.contains('selected') };`, selector, selector, selector),
	}), &snap)
	return snap, err
}

// checkStickyClickToEdit drives a sticky note at the CURRENT level
// through click-select then click-again -- the editor must open, and
// the note must not jump (no ancestor scroll). Rect sampled at every
// step so a WebKit-only movement shows in the failure text.
func checkStickyClickToEdit(c mcpCaller) (string, error) {
	parentID, err := gettingStartedParentID(c)
	if err != nil {
		return "", err
	}
	var note struct {
		ID string `json:"ID"`
	}
	if err := callBoundJSON(c, "github.com/alicoding/mill/internal/services/atlassvc.AtlasService.CreateNote",
		[]any{"click to edit probe", map[string]any{"X": 620, "Y": 200}, parentID}, &note); err != nil {
		return "", err
	}
	selector := `[data-testid="atlas-sticky-note"]:not([data-editing="true"])`
	rect := func(tag string) (string, error) {
		return c.call("js_eval", withWindow(map[string]any{
			"js": fmt.Sprintf(`const el = document.querySelector(%q);
				if (!el) return %q + ': gone';
				const r = el.getBoundingClientRect();
				return %q + ': ' + Math.round(r.x) + ',' + Math.round(r.y) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height);`, selector, tag, tag),
		}))
	}
	// Full-gesture retry (checkNoteCardCommit's own converged pattern):
	// a slow-runner fitView hitch through the stability sampler can
	// leave the click computed against pre-settle coordinates, missing
	// the note entirely on the first try.
	var r0, r1, scroll string
	var lastErr error
	for attempt := 0; attempt < 3; attempt++ {
		if err := waitForNodeStable(c, selector); err != nil {
			lastErr = fmt.Errorf("board never settled before the select click: %w", err)
			continue
		}
		r0, _ = rect("r0")
		if _, err := c.call("mouse_click", withWindow(map[string]any{"selector": selector})); err != nil {
			return "", err
		}
		r1, _ = rect("after-click1")
		scroll, _ = c.call("js_eval", withWindow(map[string]any{"js": `const panes = [...document.querySelectorAll('*')].filter((el) => el.scrollLeft > 0 || el.scrollTop > 0);
			return panes.slice(0, 4).map((el) => (el.className?.baseVal ?? String(el.className)).slice(0, 40) + '=' + el.scrollLeft + ',' + el.scrollTop).join(' | ') || 'no-scrolled-elements';`}))
		if err := pollJSEval(c, `const el = document.querySelector('[data-testid="atlas-sticky-note"]');
			return !!el && !!el.closest('.react-flow__node.selected');`, 3*time.Second); err != nil {
			lastErr = fmt.Errorf("first click never selected (%s | %s): %w", r0, r1, err)
			continue
		}
		lastErr = nil
		break
	}
	if lastErr != nil {
		return "", fmt.Errorf("after 3 attempts: %w", lastErr)
	}
	if scroll != "no-scrolled-elements" {
		return "", fmt.Errorf("click scrolled an ancestor (the WebKit reveal-on-mousedown jump): %s (%s -> %s)", scroll, r0, r1)
	}
	// The commit click gets the same self-healing retry: a miss lands
	// on the pane and deselects, the next attempt's click re-selects,
	// and the one after opens the editor.
	var r2 string
	lastErr = nil
	for attempt := 0; attempt < 3; attempt++ {
		if _, err := c.call("mouse_click", withWindow(map[string]any{"selector": selector})); err != nil {
			return "", err
		}
		r2, _ = rect("after-click2")
		if err := pollJSEval(c, `return !!document.querySelector('[data-testid="atlas-sticky-editor"]');`, 3*time.Second); err != nil {
			lastErr = fmt.Errorf("second click never opened the editor (%s | %s | %s | state=%s)", r0, r1, r2, stickyDiagnosticState(c))
			continue
		}
		lastErr = nil
		break
	}
	if lastErr != nil {
		return "", fmt.Errorf("after 3 attempts: %w", lastErr)
	}
	// CodeEditor's own focus-retry interval (AtlasStickyNode.tsx's
	// editing-entry effect, up to ~480ms) can still be in flight right
	// after the editor mounts -- wait for real focus to land inside it
	// before typing, or the keys have nowhere to go.
	if err := pollJSEval(c, `const ed = document.querySelector('[data-testid="atlas-sticky-editor"]');
		return !!ed && ed.contains(document.activeElement);`, 2*time.Second); err != nil {
		return "", fmt.Errorf("editor opened but never took focus: %w", err)
	}
	// Type into it and confirm the text lands -- both halves of the
	// click-to-edit gesture must work, not just the open.
	if _, err := c.call("keyboard_type", withWindow(map[string]any{"text": "typed!"})); err != nil {
		return "", err
	}
	if err := pollJSEval(c, `const ed = document.querySelector('[data-testid="atlas-sticky-editor"]');
		return !!ed && (ed.textContent ?? '').includes('typed!');`, 5*time.Second); err != nil {
		return "", fmt.Errorf("typing never landed in the open editor")
	}
	for i := 0; i < 2; i++ {
		if _, err := c.call("keyboard_press", withWindow(map[string]any{"key": "Escape"})); err != nil {
			return "", err
		}
	}
	// Delete the probe note: the border-flip check that follows reads
	// the FIRST sticky on the board, and a leftover (possibly still
	// selected) probe note poisons its before-selection style read.
	if err := callBoundJSON(c, "github.com/alicoding/mill/internal/services/atlassvc.AtlasService.DeleteNote", []any{note.ID}, nil); err != nil {
		return "", fmt.Errorf("cleanup delete: %w", err)
	}
	if err := pollJSEval(c, `return !document.querySelector('[data-testid="atlas-sticky-note"]');`, 5*time.Second); err != nil {
		return "", fmt.Errorf("probe note never left the board after delete: %w", err)
	}
	return fmt.Sprintf("click-select, click-edit, typing landed (%s | %s | %s)", r0, r1, r2), nil
}

// stickyDiagnosticState dumps the sticky/editor/focus/selection state
// for a failure message -- best-effort, so its own eval error is
// swallowed rather than masking the real failure it's attached to.
func stickyDiagnosticState(c mcpCaller) string {
	state, _ := c.call("js_eval", withWindow(map[string]any{"js": `const notes = [...document.querySelectorAll('[data-testid="atlas-sticky-note"]')];
		const eds = document.querySelectorAll('[data-testid="atlas-sticky-editor"]').length;
		return 'notes=' + notes.map((n) => n.getAttribute('data-editing')).join(',') + ' editors=' + eds
			+ ' focus=' + (document.activeElement?.tagName ?? 'none')
			+ ' selected=' + document.querySelectorAll('.react-flow__node.selected').length;`}))
	return state
}
