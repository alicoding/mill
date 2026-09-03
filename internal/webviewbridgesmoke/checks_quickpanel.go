package main

import (
	"fmt"
	"time"
)

// The Quick Panel checks (goal 0303): owner reports on the installed
// build that Chromium's suite cannot reproduce -- one Down press moving
// two rows, hover and trackpad scroll jumping the list -- so the real
// WKWebView is the engine the regression tests must run on.
const quickPanelWindowName = "quickpanel"

func inQuickPanel(args map[string]any) map[string]any {
	args["window"] = quickPanelWindowName
	return args
}

// activeRowJS reports the active row's index among the list's options,
// and the list's scroll offset, from the panel's search input.
const activeRowJS = `const input = document.querySelector('input[aria-label="Quick Panel search"]');
	const ids = [...document.querySelectorAll('[role="option"]')].map((e) => e.id);
	const cur = input ? input.getAttribute('aria-activedescendant') : null;
	const list = document.querySelector('[role="listbox"]');
	const scroller = list ? (list.closest('[data-scroll-container], .overflow-auto, [style*="overflow"]') || list.parentElement) : null;
	return { n: ids.length, idx: ids.indexOf(cur), scrollTop: scroller ? scroller.scrollTop : -1, focused: !!input && document.activeElement === input };`

type activeRow struct {
	N         int  `json:"n"`
	Idx       int  `json:"idx"`
	ScrollTop int  `json:"scrollTop"`
	Focused   bool `json:"focused"`
}

func readActiveRow(c mcpCaller) (activeRow, error) {
	// The bridge hands a returned object back already decoded, so the
	// probe returns the object itself.
	var row activeRow
	if err := c.callJSON("js_eval", inQuickPanel(map[string]any{"js": activeRowJS}), &row); err != nil {
		return activeRow{}, err
	}
	return row, nil
}

func showQuickPanel(c mcpCaller) error {
	if err := callBoundJSON(c, "github.com/alicoding/mill/internal/services/settingssvc.SettingsService.ShowPanel", []any{}, nil); err != nil {
		return fmt.Errorf("ShowPanel: %w", err)
	}
	deadline := time.Now().Add(10 * time.Second)
	var last activeRow
	var lastErr error
	for time.Now().Before(deadline) {
		row, err := readActiveRow(c)
		last, lastErr = row, err
		if err == nil && row.Focused && row.N > 2 {
			return nil
		}
		time.Sleep(200 * time.Millisecond)
	}
	windows, _ := c.call("windows_list", map[string]any{})
	return fmt.Errorf("the Quick Panel never showed with its search focused and rows listed (last probe %+v, err %v, windows %s)", last, lastErr, windows)
}

func hideQuickPanel(c mcpCaller) {
	// Dismiss through the panel's own bound door, so the main-window
	// checks that follow never inherit a focused panel.
	_ = callBoundJSON(c, "github.com/alicoding/mill/internal/services/settingssvc.SettingsService.DismissPanel", []any{}, nil)
}

func checkQuickPanelDownStepsOnce(c mcpCaller) (string, error) {
	if err := showQuickPanel(c); err != nil {
		return "", err
	}
	defer hideQuickPanel(c)
	before, err := readActiveRow(c)
	if err != nil {
		return "", err
	}
	if _, err := c.call("keyboard_press", inQuickPanel(map[string]any{"key": "ArrowDown"})); err != nil {
		return "", err
	}
	time.Sleep(150 * time.Millisecond)
	after, err := readActiveRow(c)
	if err != nil {
		return "", err
	}
	if !after.Focused {
		return "", fmt.Errorf("the search lost focus on ArrowDown (active row %d -> %d)", before.Idx, after.Idx)
	}
	if after.Idx != before.Idx+1 {
		raw, _ := c.call("js_eval", inQuickPanel(map[string]any{"js": `const input = document.querySelector('input[aria-label="Quick Panel search"]');
			const a = document.activeElement;
			const sel = [...document.querySelectorAll('[role="option"]')].findIndex((e) => e.getAttribute('aria-selected') === 'true' || e.hasAttribute('data-is-active-descendant'));
			const descId = input ? input.getAttribute('aria-activedescendant') : null;
			const desc = descId ? document.getElementById(descId) : null;
			return 'activeElement=' + (a ? a.tagName + '#' + a.id + '.' + String(a.className).slice(0, 40) : 'none') + ' activedescendant=' + descId + ' selectedIdx=' + sel + ' descendantEl=' + (desc ? desc.outerHTML.slice(0, 320) : 'none');`}))
		return "", fmt.Errorf("one ArrowDown moved the active row from %d to %d (want %d) of %d -- %s", before.Idx, after.Idx, before.Idx+1, after.N, raw)
	}
	return fmt.Sprintf("one ArrowDown: row %d -> %d of %d, search still focused", before.Idx, after.Idx, after.N), nil
}

func checkQuickPanelHoverDoesNotScroll(c mcpCaller) (string, error) {
	if err := showQuickPanel(c); err != nil {
		return "", err
	}
	defer hideQuickPanel(c)
	before, err := readActiveRow(c)
	if err != nil {
		return "", err
	}
	// Hover the third row, then the first: the active row follows the
	// pointer, the list itself must hold still.
	for _, nth := range []int{3, 1} {
		if _, err := c.call("mouse_move", inQuickPanel(map[string]any{"selector": fmt.Sprintf("[role=\"option\"]:nth-of-type(%d)", nth), "duration_ms": 120})); err != nil {
			return "", err
		}
		time.Sleep(150 * time.Millisecond)
	}
	after, err := readActiveRow(c)
	if err != nil {
		return "", err
	}
	if after.ScrollTop != before.ScrollTop {
		raw, _ := c.call("js_eval", inQuickPanel(map[string]any{"js": `const list = document.querySelector('[role="listbox"]');
			const scroller = list ? (list.closest('[data-scroll-container], .overflow-auto, [style*="overflow"]') || list.parentElement) : null;
			const first = document.querySelector('[role="option"]');
			const input = document.querySelector('input[aria-label="Quick Panel search"]');
			return 'scroller=' + (scroller ? scroller.tagName + '.' + String(scroller.className).slice(0, 60) + ' h=' + scroller.clientHeight + ' sh=' + scroller.scrollHeight + ' overflowY=' + getComputedStyle(scroller).overflowY : 'none') + ' firstRowTop=' + (first ? Math.round(first.getBoundingClientRect().top) : 'none') + ' listTop=' + (list ? Math.round(list.getBoundingClientRect().top) : 'none') + ' inputInScroller=' + (scroller && input ? scroller.contains(input) : 'n/a') + ' inputBottom=' + (input ? Math.round(input.getBoundingClientRect().bottom) : 'none');`}))
		return "", fmt.Errorf("hovering rows scrolled the list: scrollTop %d -> %d -- %s", before.ScrollTop, after.ScrollTop, raw)
	}
	return fmt.Sprintf("hovering rows left scrollTop at %d (active row %d -> %d)", after.ScrollTop, before.Idx, after.Idx), nil
}

func checkQuickPanelRowsShareOneHeight(c mcpCaller) (string, error) {
	if err := showQuickPanel(c); err != nil {
		return "", err
	}
	defer hideQuickPanel(c)
	var h struct {
		Min float64 `json:"min"`
		Max float64 `json:"max"`
		N   int     `json:"n"`
	}
	if err := c.callJSON("js_eval", inQuickPanel(map[string]any{"js": `const hs = [...document.querySelectorAll('[role="option"]')].map((e) => e.getBoundingClientRect().height);
		return { min: Math.min(...hs), max: Math.max(...hs), n: hs.length };`}), &h); err != nil {
		return "", err
	}
	if h.Max-h.Min > 1 {
		tallest, _ := c.call("js_eval", inQuickPanel(map[string]any{"js": `const rows = [...document.querySelectorAll('[role="option"]')];
			rows.sort((a, b) => b.getBoundingClientRect().height - a.getBoundingClientRect().height);
			const r = rows[0];
			if (!r) return 'none';
			const parts = [...r.querySelectorAll('[data-component], [class*="Description"], [class*="TrailingVisual"], [class*="Label"]')].map((e) => (e.getAttribute('data-component') || e.className.toString().slice(0, 40)) + ':' + Math.round(e.getBoundingClientRect().height) + 'px/' + getComputedStyle(e).whiteSpace + '/' + getComputedStyle(e).display);
			return r.getAttribute('data-id') + ' -> ' + parts.join(' | ');`}))
		return "", fmt.Errorf("rows range from %.0f to %.0f px tall across %d rows -- a long row grows instead of truncating; tallest: %s", h.Min, h.Max, h.N, tallest)
	}
	return fmt.Sprintf("%d rows, all %.0f px tall", h.N, h.Max), nil
}
