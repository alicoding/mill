package main

import (
	"fmt"
	"os"
	"path/filepath"
	"time"
)

// A minimal two-page drawio file: page switching only exists with 2+
// pages, so a single-page fixture could never exercise the editor's
// tab bar at all.
const drawioTwoPageFixture = `<mxfile host="app.diagrams.net" type="device">
  <diagram id="smoke-page-one" name="Overview">
    <mxGraphModel dx="800" dy="600" grid="1" gridSize="10" page="1" pageScale="1" pageWidth="850" pageHeight="1100">
      <root>
        <mxCell id="0" />
        <mxCell id="1" parent="0" />
        <mxCell id="a1" value="Alpha" style="rounded=0;whiteSpace=wrap;html=1;" vertex="1" parent="1">
          <mxGeometry x="120" y="120" width="120" height="60" as="geometry" />
        </mxCell>
      </root>
    </mxGraphModel>
  </diagram>
  <diagram id="smoke-page-two" name="Detail">
    <mxGraphModel dx="800" dy="600" grid="1" gridSize="10" page="1" pageScale="1" pageWidth="850" pageHeight="1100">
      <root>
        <mxCell id="0" />
        <mxCell id="1" parent="0" />
        <mxCell id="b1" value="Gamma" style="rounded=1;whiteSpace=wrap;html=1;" vertex="1" parent="1">
          <mxGeometry x="200" y="160" width="140" height="70" as="geometry" />
        </mxCell>
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>`

// landTwoPageDiagram writes the fixture to a throwaway path and lands
// it as a diagram board object through the same RPC a native drop
// uses, waiting until the board face renders and settles.
func landTwoPageDiagram(c mcpCaller) error {
	dir, err := os.MkdirTemp("", "mill-smoke-drawio")
	if err != nil {
		return err
	}
	fixturePath := filepath.Join(dir, "two-page-smoke.drawio")
	if err := os.WriteFile(fixturePath, []byte(drawioTwoPageFixture), 0o600); err != nil {
		return err
	}
	parentID, err := gettingStartedParentID(c)
	if err != nil {
		return err
	}
	var obj struct {
		ID string `json:"ID"`
	}
	if err := callBoundJSON(c, "github.com/alicoding/mill/internal/services/atlassvc.AtlasService.CreateBoardObject",
		[]any{"diagram", map[string]any{"mirrorPath": fixturePath, "title": "smoke two-page"}, map[string]any{"X": 620, "Y": 340}, parentID}, &obj); err != nil {
		return err
	}
	bodySel := `[data-testid="atlas-drawio-page-body"]`
	if err := pollJSEval(c, fmt.Sprintf(`return !!document.querySelector('%s');`, bodySel), 15*time.Second); err != nil {
		return fmt.Errorf("diagram board face never rendered after CreateBoardObject: %w", err)
	}
	if err := waitForNodeStable(c, bodySel); err != nil {
		return fmt.Errorf("board never settled before the band click: %w", err)
	}
	return nil
}

// bandSel is the diagram's chrome band -- the drag surface (the
// vendored viewer captures body pointer events for pan/zoom; a body
// CLICK still selects via the shared renderer's capture-phase
// forwarding, goal 0259).
const drawioBandSel = `.react-flow__node [data-testid="atlas-board-object-frame"]`

// openDrawioEditor double-clicks the band to open the embedded editor.
// Two bridge clicks land faster than the OS double-click threshold
// reliably here; a synthesized dblclick is the one escape hatch,
// allowed because the bridge has no native dblclick primitive and the
// double-click GATE itself is proven by e2e.
func openDrawioEditor(c mcpCaller, dialogSel string) error {
	for i := 0; i < 2; i++ {
		if _, err := c.call("mouse_click", withWindow(map[string]any{"selector": drawioBandSel})); err != nil {
			return err
		}
	}
	if pollJSEval(c, fmt.Sprintf(`return !!document.querySelector('%s iframe');`, dialogSel), 20*time.Second) == nil {
		return nil
	}
	if err := pollJSEval(c, fmt.Sprintf(`const band = document.querySelector('%s');
		if (!band) return false;
		band.dispatchEvent(new MouseEvent('dblclick', {bubbles: true, cancelable: true}));
		return true;`, drawioBandSel), 3*time.Second); err != nil {
		return fmt.Errorf("no chrome band to double-click: %w", err)
	}
	if err := pollJSEval(c, fmt.Sprintf(`return !!document.querySelector('%s iframe');`, dialogSel), 20*time.Second); err != nil {
		return fmt.Errorf("embedded editor dialog never opened: %w", err)
	}
	return nil
}

// closeDrawioEditor dismisses the modal this check opened. The editor
// is a full-window dialog: leaving it up makes every later check's
// pointer event land on the editor iframe instead of the board, which
// reads as an engine divergence rather than the state leak it is. The
// Dialog's own Close control is the affordance (DrawioEditorDialog
// wires it to the same handleExit the engine's own Exit button
// reaches).
//
// Addressed by data-component, not by aria-label: Primer's IconButton
// moves the accessible name onto its tooltip via aria-labelledby
// whenever it renders one, leaving the button element itself with no
// aria-label attribute at all. data-component is the stable handle.
func closeDrawioEditor(c mcpCaller, dialogSel string) error {
	if _, err := c.call("mouse_click", withWindow(map[string]any{
		"selector": dialogSel + ` [data-component="Dialog.CloseButton"]`,
	})); err != nil {
		return fmt.Errorf("editor did not close: no Close control to click: %w", err)
	}
	if err := pollJSEval(c, `return !document.querySelector('[data-testid="drawio-editor-frame"]');`, 10*time.Second); err != nil {
		return fmt.Errorf("editor did not close: the editor frame is still on the page: %w", err)
	}
	return nil
}

func checkDrawioEditorLayout(c mcpCaller) (string, error) {
	if err := landTwoPageDiagram(c); err != nil {
		return "", err
	}

	// Clicking the diagram BODY must select in the real engine too
	// (goal 0259): the shared renderer forwards selection at capture
	// phase before the vendored viewer can consume the pointerdown --
	// pointer/selection semantics are the known engine-divergence
	// class, so the Chromium e2e alone doesn't prove this.
	if _, err := c.call("mouse_click", withWindow(map[string]any{"selector": `[data-testid="atlas-drawio-page-body"]`})); err != nil {
		return "", err
	}
	if err := pollJSEval(c, `return document.querySelectorAll('.react-flow__resize-control').length >= 8;`, 5*time.Second); err != nil {
		return "", fmt.Errorf("resize handles never appeared after clicking the diagram body: %w", err)
	}
	if _, err := c.call("keyboard_press", withWindow(map[string]any{"key": "Escape"})); err != nil {
		return "", err
	}
	if err := pollJSEval(c, `return document.querySelectorAll('.react-flow__resize-control').length === 0;`, 5*time.Second); err != nil {
		return "", fmt.Errorf("selection never cleared after Escape: %w", err)
	}

	// Selecting the band must produce the shared NodeResizer's full
	// handle set in the real engine, exactly as Chromium renders it.
	if _, err := c.call("mouse_click", withWindow(map[string]any{"selector": drawioBandSel})); err != nil {
		return "", err
	}
	if err := pollJSEval(c, `return document.querySelectorAll('.react-flow__resize-control').length >= 8;`, 5*time.Second); err != nil {
		return "", fmt.Errorf("resize handles never appeared after selecting the diagram's chrome band: %w", err)
	}

	dialogSel := `[data-component="atlas-drawio-editor-dialog"]`
	if err := openDrawioEditor(c, dialogSel); err != nil {
		return "", err
	}

	// The clipping class this check pins (goal 0259): the editor's
	// bottom chrome -- where drawio's own page tabs live -- must sit
	// INSIDE the real window, and the tab bar itself must be present
	// and reachable for a multi-page file. Same-origin iframe, so its
	// document is directly measurable.
	if err := pollJSEval(c, fmt.Sprintf(`const f = document.querySelector('%s iframe');
		const d = f && f.contentDocument;
		return !!(d && d.querySelector('.geTabContainer'));`, dialogSel), 30*time.Second); err != nil {
		return "", fmt.Errorf("the editor's page-tab bar (.geTabContainer) never appeared for a two-page file: %w", err)
	}
	verdict, err := c.call("js_eval", withWindow(map[string]any{
		"js": fmt.Sprintf(`const dlg = document.querySelector('%s');
			const f = dlg.querySelector('iframe');
			const dr = dlg.getBoundingClientRect();
			const fr = f.getBoundingClientRect();
			const tabs = f.contentDocument.querySelector('.geTabContainer');
			const tr = tabs.getBoundingClientRect();
			const tabsBottomInWindow = fr.top + tr.bottom;
			const H = window.innerHeight;
			if (dr.bottom > H + 1) return "dialog-overflows:" + Math.round(dr.bottom) + ">" + H;
			if (fr.bottom > dr.bottom + 1) return "iframe-overflows-dialog:" + Math.round(fr.bottom) + ">" + Math.round(dr.bottom);
			if (tabsBottomInWindow > H + 1) return "tabs-clipped:" + Math.round(tabsBottomInWindow) + ">" + H;
			if (tr.height < 8) return "tabs-zero-height";
			return "ok dialog=" + Math.round(dr.height) + "px iframe=" + Math.round(fr.height) + "px tabsBottom=" + Math.round(tabsBottomInWindow) + "px window=" + H + "px";`, dialogSel),
	}))
	if err != nil {
		return "", err
	}
	if len(verdict) < 2 || verdict[:2] != "ok" {
		return "", fmt.Errorf("editor layout broken in the real engine: %s", verdict)
	}
	if err := closeDrawioEditor(c, dialogSel); err != nil {
		return "", err
	}
	return "board face selectable via band with full resize handles; editor dialog, iframe, and the two-page tab bar all inside the real window, editor closed (" + verdict + ")", nil
}
