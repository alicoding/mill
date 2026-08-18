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
	run    func(c *mcpClient) (string, error)
}

var registry = []check{
	{
		name:   "isolated-data-badge",
		reason: "confirms the real desktop window is serving throwaway MILL_SETTINGS_PATH/MILL_EXECUTION_DB_PATH, never real user data, before any further check touches it (mirrors frontend/e2e/fixtures/server.ts's own per-server guard).",
		run:    checkIsolatedDataBadge,
	},
	{
		name:   "app-info-window-sane",
		reason: "the real Wails process reports exactly one live window on darwin -- proves a genuine desktop process booted, not just that a binary exists.",
		run:    checkAppInfo,
	},
	{
		name:   "atlas-board-renders",
		reason: "the real WKWebView actually mounts the SPA and renders the Atlas board -- a page that never finishes loading in the real engine would pass a Chromium-only suite untouched.",
		run:    checkAtlasBoardRenders,
	},
	{
		name:   "note-card-flip-interaction",
		reason: "a real WKWebView pointer event round-trips into React state (js_eval per the coordinator's own brief for this check) -- the flip is Atlas's most basic interaction, gates everything after it.",
		run:    checkNoteCardFlip,
	},
	{
		name:   "note-card-selection-ring",
		reason: "the burned class of bug this goal exists for: the selected note-card's box-shadow ring (AtlasNoteCardNode.module.css's :global(.react-flow__node.selected) rule) rendered none in real WebKit while Chromium rendered it fine.",
		run:    checkNoteCardSelectionRing,
	},
	{
		name:   "sticky-border-color-flip",
		reason: "the second burned class: a selected sticky note's border-color flip to the accent token (AtlasStickyNode.module.css) -- a real Note, created live via AtlasService.CreateNote so the check exercises the same call_bound_method path an agent driving Mill would use.",
		run:    checkStickyBorderColorFlip,
	},
}

func checkIsolatedDataBadge(c *mcpClient) (string, error) {
	var found bool
	if err := c.callJSON("js_eval", map[string]any{
		"js": `return !!document.querySelector('[data-testid="isolated-data-badge"]');`,
	}, &found); err != nil {
		return "", err
	}
	if !found {
		return "", fmt.Errorf("isolated-data-badge not present -- refusing to trust this window's data isolation")
	}
	return "badge visible", nil
}

func checkAppInfo(c *mcpClient) (string, error) {
	var info struct {
		OS      string `json:"os"`
		Windows []struct {
			Name string `json:"name"`
		} `json:"windows"`
	}
	if err := c.callJSON("app_info", map[string]any{}, &info); err != nil {
		return "", err
	}
	if info.OS != "darwin" {
		return "", fmt.Errorf("expected os darwin, got %q", info.OS)
	}
	if len(info.Windows) != 1 {
		return "", fmt.Errorf("expected exactly 1 window, got %d", len(info.Windows))
	}
	return fmt.Sprintf("os=%s window=%q", info.OS, info.Windows[0].Name), nil
}

// pollJSEval retries a boolean-returning js_eval snippet until it's
// true or the deadline passes -- the real webview's page load and
// React's own render pass are both async relative to the MCP HTTP
// server becoming reachable.
func pollJSEval(c *mcpClient, js string, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	var lastErr error
	for time.Now().Before(deadline) {
		var ok bool
		if err := c.callJSON("js_eval", map[string]any{"js": js}, &ok); err != nil {
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

func checkAtlasBoardRenders(c *mcpClient) (string, error) {
	var nav struct {
		Clicked bool   `json:"clicked"`
		Tag     string `json:"tag"`
	}
	if err := c.callJSON("js_eval", map[string]any{
		"js": `const candidates = [...document.querySelectorAll('a,button,[role="link"],[role="button"]')];
			const link = candidates.find(el => (el.textContent||'').trim() === 'Atlas' || el.getAttribute('aria-label') === 'Atlas');
			if (!link) throw new Error('Atlas nav entry not found among ' + candidates.length + ' candidates');
			link.click();
			return { clicked: true, tag: link.tagName };`,
	}, &nav); err != nil {
		return "", err
	}
	if err := pollJSEval(c, `return !!document.querySelector('[data-testid="atlas-board"]');`, 10*time.Second); err != nil {
		return "", fmt.Errorf("atlas board never rendered after clicking nav (%s): %w", nav.Tag, err)
	}
	return "atlas-board rendered after nav click", nil
}

func checkNoteCardFlip(c *mcpClient) (string, error) {
	var result struct {
		Before string `json:"before"`
		After  string `json:"after"`
		Label  string `json:"label"`
	}
	if err := c.callJSON("js_eval", map[string]any{
		"js": `const card = document.querySelector('[data-testid="atlas-note-card"]');
			if (!card) throw new Error('no seeded note card found to click');
			const before = card.dataset.flipped;
			const label = card.getAttribute('aria-label') || '';
			card.click();
			await new Promise(r => setTimeout(r, 200));
			const after = document.querySelector('[data-testid="atlas-note-card"]').dataset.flipped;
			return { before, after, label };`,
	}, &result); err != nil {
		return "", err
	}
	if result.Before != "false" || result.After != "true" {
		return "", fmt.Errorf("expected flipped false->true, got %s->%s (card: %s)", result.Before, result.After, result.Label)
	}
	return fmt.Sprintf("flipped false->true (%s)", result.Label), nil
}

type ringSnapshot struct {
	BoxShadow string `json:"boxShadow"`
	Selected  bool   `json:"selected"`
}

func readRing(c *mcpClient, selector string) (ringSnapshot, error) {
	var snap ringSnapshot
	err := c.callJSON("js_eval", map[string]any{
		"js": fmt.Sprintf(`const el = document.querySelectorAll(%q)[0];
			if (!el) throw new Error('element not found: %s');
			const wrapper = el.closest('.react-flow__node');
			const style = getComputedStyle(el);
			return { boxShadow: style.boxShadow, selected: wrapper ? wrapper.classList.contains('selected') : false };`, selector, selector),
	}, &snap)
	return snap, err
}

func checkNoteCardSelectionRing(c *mcpClient) (string, error) {
	selector := `[data-testid="atlas-note-card"]`
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
	if _, err := c.call("mouse_click", map[string]any{
		"selector":  selector,
		"modifiers": []string{"shift"},
	}); err != nil {
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

// atlasCard mirrors internal/domain/atlas.Card's JSON shape closely
// enough to read Title/ID/ParentID off AtlasService.Cards() -- the
// note-nesting parent this check needs is whatever card the seeded
// "Getting started" card itself lives under, not a hardcoded ID.
type atlasCard struct {
	ID       string `json:"ID"`
	Title    string `json:"Title"`
	ParentID string `json:"ParentID"`
}

func checkStickyBorderColorFlip(c *mcpClient) (string, error) {
	var cards []atlasCard
	if err := c.callJSON("call_bound_method", map[string]any{
		"name": "github.com/alicoding/mill/internal/services/atlassvc.AtlasService.Cards",
		"args": []any{},
	}, &cards); err != nil {
		return "", err
	}
	var parentID string
	for _, card := range cards {
		if card.Title == "Getting started" {
			parentID = card.ParentID
			break
		}
	}
	if parentID == "" {
		return "", fmt.Errorf("seeded card \"Getting started\" not found -- can't place the check's sticky note at the right board level")
	}

	var note struct {
		ID string `json:"ID"`
	}
	if err := c.callJSON("call_bound_method", map[string]any{
		"name": "github.com/alicoding/mill/internal/services/atlassvc.AtlasService.CreateNote",
		"args": []any{"webview-bridge-smoke check", map[string]any{"X": 340, "Y": 340}, parentID},
	}, &note); err != nil {
		return "", err
	}

	selector := `[data-testid="atlas-sticky-note"]`
	if err := pollJSEval(c, fmt.Sprintf(`return !!document.querySelector('%s');`, selector), 10*time.Second); err != nil {
		return "", fmt.Errorf("sticky note never rendered after AtlasService.CreateNote: %w", err)
	}

	before, err := readStickyStyle(c, selector)
	if err != nil {
		return "", err
	}
	if _, err := c.call("mouse_click", map[string]any{
		"selector":  selector,
		"modifiers": []string{"shift"},
	}); err != nil {
		return "", err
	}
	after, err := readStickyStyle(c, selector)
	if err != nil {
		return "", err
	}
	if before.BorderColor == after.BorderColor {
		return "", fmt.Errorf("border-color did not flip on selection: stayed %q", before.BorderColor)
	}
	if after.BoxShadow == "none" {
		return "", fmt.Errorf("sticky selection ring did not render: box-shadow is none after shift-click select")
	}
	return fmt.Sprintf("border-color %s -> %s, box-shadow none -> %s", before.BorderColor, after.BorderColor, after.BoxShadow), nil
}

type stickySnapshot struct {
	BorderColor string `json:"borderColor"`
	BoxShadow   string `json:"boxShadow"`
}

func readStickyStyle(c *mcpClient, selector string) (stickySnapshot, error) {
	var snap stickySnapshot
	err := c.callJSON("js_eval", map[string]any{
		"js": fmt.Sprintf(`const el = document.querySelector(%q);
			if (!el) throw new Error('element not found: %s');
			const style = getComputedStyle(el);
			return { borderColor: style.borderColor, boxShadow: style.boxShadow };`, selector, selector),
	}, &snap)
	return snap, err
}
