package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// smokePdfBytes builds a minimal single-page PDF whose page text
// contains the query token twice, with a correct xref (pdf.js has a
// lenient recovery path for broken files, but a smoke fixture must
// never depend on leniency). Uncompressed Type1/Helvetica text keeps
// extraction trivial for any conformant reader.
func smokePdfBytes() []byte {
	content := "BT /F1 24 Tf 72 700 Td (SmokeAlpha finds text) Tj 0 -40 Td (SmokeAlpha again) Tj ET"
	objects := []string{
		"<< /Type /Catalog /Pages 2 0 R >>",
		"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
		"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
		fmt.Sprintf("<< /Length %d >>\nstream\n%s\nendstream", len(content), content),
		"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
	}
	var b strings.Builder
	b.WriteString("%PDF-1.4\n")
	offsets := make([]int, len(objects))
	for i, obj := range objects {
		offsets[i] = b.Len()
		fmt.Fprintf(&b, "%d 0 obj\n%s\nendobj\n", i+1, obj)
	}
	xrefAt := b.Len()
	fmt.Fprintf(&b, "xref\n0 %d\n0000000000 65535 f \n", len(objects)+1)
	for _, off := range offsets {
		fmt.Fprintf(&b, "%010d 00000 n \n", off)
	}
	fmt.Fprintf(&b, "trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n", len(objects)+1, xrefAt)
	return []byte(b.String())
}

const pdfViewerIframeSel = `iframe[data-testid="atlas-pdf-viewer"]`

// checkPdfFindInViewer lands a pdf board object over a fixture with
// known text, waits for the vendored pdf.js viewer to load the
// document in the REAL WKWebView, then drives the viewer's own find
// controller (eventBus 'find', the same engine path the findbar's
// input feeds) and asserts the match count. The Chromium and
// Playwright-WebKit layers both pass this pipeline; this check exists
// because the installed app's WKWebView is the one engine they can't
// impersonate (goal 0271's open find defect).
func checkPdfFindInViewer(c mcpCaller) (string, error) {
	dir, err := os.MkdirTemp("", "mill-smoke-pdf")
	if err != nil {
		return "", err
	}
	fixturePath := filepath.Join(dir, "find-smoke.pdf")
	if err := os.WriteFile(fixturePath, smokePdfBytes(), 0o600); err != nil {
		return "", err
	}
	parentID, err := gettingStartedParentID(c)
	if err != nil {
		return "", err
	}
	var obj struct {
		ID string `json:"ID"`
	}
	if err := callBoundJSON(c, "github.com/alicoding/mill/internal/services/atlassvc.AtlasService.CreateBoardObject",
		[]any{"pdf", map[string]any{"mirrorPath": fixturePath, "title": "smoke find"}, map[string]any{"X": 620, "Y": 620}, parentID}, &obj); err != nil {
		return "", err
	}
	// The viewer iframe mounts behind the click shield without needing
	// selection; the shield only overlays pointer events.
	if err := pollJSEval(c, fmt.Sprintf(`return !!document.querySelector(%q);`, pdfViewerIframeSel), 20*time.Second); err != nil {
		return "", fmt.Errorf("pdf viewer iframe never mounted after CreateBoardObject: %w", err)
	}
	// Same-origin access into the viewer document is itself part of
	// the contract under test -- a cross-origin throw here IS an
	// engine finding, surfaced as this check's failure.
	if err := pollJSEval(c, fmt.Sprintf(`const f = document.querySelector(%q);
		const w = f && f.contentWindow;
		const app = w && w.PDFViewerApplication;
		return !!(app && app.pdfDocument);`, pdfViewerIframeSel), 30*time.Second); err != nil {
		return "", fmt.Errorf("pdf.js never loaded the document in the real webview: %w", err)
	}
	// The find controller's own text extraction runs alongside the
	// query here purely so a failure can say WHY nothing matched: an
	// extraction that throws (the engine-gap shape) is a different
	// defect from a query that extracts fine and still misses.
	if _, err := c.call("js_eval", withWindow(map[string]any{
		"js": fmt.Sprintf(`const f = document.querySelector(%q);
			const app = f.contentWindow.PDFViewerApplication;
			window.__millSmokeFindTotal = -1;
			window.__millSmokeFindStates = [];
			window.__millSmokeText = 'pending';
			app.eventBus.on('updatefindmatchescount', (e) => { window.__millSmokeFindTotal = e.matchesCount.total; });
			app.eventBus.on('updatefindcontrolstate', (e) => { window.__millSmokeFindStates.push(e.state); });
			app.pdfDocument.getPage(1)
				.then((p) => p.getTextContent())
				.then((t) => { window.__millSmokeText = 'ok ' + t.items.length + ' items'; })
				.catch((e) => { window.__millSmokeText = 'ERR ' + e; });
			app.eventBus.dispatch('find', { source: null, type: '', query: 'smokealpha', caseSensitive: false, entireWord: false, highlightAll: true, findPrevious: false });
			return "dispatched";`, pdfViewerIframeSel),
	})); err != nil {
		return "", err
	}
	if err := pollJSEval(c, `return window.__millSmokeFindTotal === 2;`, 15*time.Second); err != nil {
		return "", fmt.Errorf("find never reported 2 matches (%s): %w", pdfFindDiagnostics(c), err)
	}
	return "pdf.js find matched 2/2 in the real WKWebView", nil
}

// pdfFindDiagnostics reads the find pipeline's own trail for a failure
// message -- best-effort, so its own eval error never masks the real
// failure it is attached to.
func pdfFindDiagnostics(c mcpCaller) string {
	diag, err := c.call("js_eval", withWindow(map[string]any{
		"js": `return 'lastTotal=' + window.__millSmokeFindTotal
			+ ' states=[' + (window.__millSmokeFindStates || []).join(',') + ']'
			+ ' textExtraction=' + window.__millSmokeText;`,
	}))
	if err != nil {
		return "diagnostics unreadable"
	}
	return diag
}
