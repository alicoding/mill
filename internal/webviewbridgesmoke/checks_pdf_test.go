package main

import (
	"bytes"
	"fmt"
	"strings"
	"testing"
)

// The fixture must stand on a correct xref, never pdf.js's lenient
// recovery path: every recorded offset points at its own "N 0 obj"
// header, and the query token appears exactly twice.
func TestSmokePdfBytes_WellFormed(t *testing.T) {
	pdf := smokePdfBytes()
	if !bytes.HasPrefix(pdf, []byte("%PDF-1.4")) {
		t.Fatalf("missing PDF header")
	}
	if got := bytes.Count(pdf, []byte("SmokeAlpha")); got != 2 {
		t.Fatalf("query token count = %d, want 2", got)
	}
	xrefAt := bytes.Index(pdf, []byte("xref\n"))
	if xrefAt < 0 {
		t.Fatalf("no xref table")
	}
	// Parse the five in-use entries and check each offset lands on the
	// matching object header.
	lines := strings.Split(string(pdf[xrefAt:]), "\n")
	// lines[0]="xref", [1]="0 6", [2]=the free entry, [3..7]=objects
	for i := 1; i <= 5; i++ {
		var off, gen int
		if _, err := fmt.Sscanf(lines[2+i], "%010d %05d n", &off, &gen); err != nil {
			t.Fatalf("xref entry %d unparseable (%q): %v", i, lines[2+i], err)
		}
		want := fmt.Sprintf("%d 0 obj", i)
		if !bytes.HasPrefix(pdf[off:], []byte(want)) {
			t.Errorf("xref offset for object %d points at %q, want %q", i, pdf[off:off+10], want)
		}
	}
	// startxref must name the xref table's own offset.
	var startAt int
	tail := pdf[bytes.LastIndex(pdf, []byte("startxref")):]
	if _, err := fmt.Sscanf(string(tail), "startxref\n%d", &startAt); err != nil {
		t.Fatalf("startxref unparseable: %v", err)
	}
	if startAt != xrefAt {
		t.Errorf("startxref = %d, want %d", startAt, xrefAt)
	}
}

func TestCheckPdfFindInViewer(t *testing.T) {
	seedCards := []atlasCard{{ID: "card-1", Title: "Discovery workstream", ParentID: "space-1"}}

	t.Run("two matches in the real viewer passes", func(t *testing.T) {
		f := newFakeCaller()
		f.onJSON("call_bound_method", seedCards)
		f.on("js_eval", func(map[string]any) (string, error) { return "intact", nil }) // repairAppDispatch after Cards
		f.onJSON("call_bound_method", map[string]any{"ID": "pdf-1"})
		f.on("js_eval", func(map[string]any) (string, error) { return "intact", nil }) // repairAppDispatch after CreateBoardObject
		f.onJSON("js_eval", true)                                                      // poll: iframe mounted
		f.onJSON("js_eval", true)                                                      // poll: pdfDocument loaded
		f.on("js_eval", func(map[string]any) (string, error) { return "dispatched", nil })
		f.onJSON("js_eval", true) // poll: total === 2

		detail, err := checkPdfFindInViewer(f)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if !strings.Contains(detail, "2/2") {
			t.Errorf("got %q", detail)
		}
	})

}
