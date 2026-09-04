package atlas

import (
	"time"

	"github.com/alicoding/mill/internal/domain/seedorigin"
)

// BoardObjectSeedAssetKey marks a BuiltInBoardObjects golden as
// file-backed with no mirrorPath of its own yet -- exported so
// atlassvc's own reconcile (the one layer with a real captures
// directory, domain packages stay persistence-free per backend.md) can
// find the key, resolve its bytes via BuiltInBoardObjectAsset, write
// them to disk, and fill Payload["mirrorPath"] before insert.
const BoardObjectSeedAssetKey = "seedAsset"

// BuiltInBoardObjects returns the seeded board-object examples (goal
// 0223): every golden below is a child of cardSketchesID
// (builtin.go), never a direct child of "The engagement" itself --
// that card's own comment has the full reasoning (a fresh install and
// every e2e worker auto-enters "The engagement" by default; a board
// object rendered there widens that board's own fitView content
// extent, shifting where every OTHER spec's percentage-of-viewport and
// auto-placed points land). Position stays a small, tight cluster
// (X:80-740, Y:80) since cardSketchesID's own canvas starts empty --
// no seeded card row to clear here the way root's Y:80 cards make
// necessary elsewhere. Every ID carries the "atlas-object-example-"
// prefix deliberately -- a shared-pool spec creating its own object of
// the same Kind, while VIEWING this card directly (rare), must exclude
// this prefix from its own kind-scoped locator (this package's own
// const block above has the worked example).
//
// 'table' is deliberately NOT seeded here: its own artifact is a
// Configure List (tableTool.ts's own ConfigureService.CreateList),
// owned by configuresvc's seed lifecycle, not atlassvc's -- seeding
// one from this package would mean either reaching across that
// boundary or duplicating list.BuiltIn()'s own reconcile, neither of
// which this goal's scope covers. A follow-up that seeds a built-in
// List and references its ID here can close this gap.
func BuiltInBoardObjects() []BoardObject {
	now := time.Now()
	return []BoardObject{
		{
			// The rotated-shape proof (goal 0214's own retroactive seed):
			// a styled rectangle carrying a nonzero Payload["rotation"],
			// the exact key/format SetBoardObjectRotation itself writes.
			ID: objectShapeExampleID, Kind: "shape",
			Payload: map[string]string{
				"shapeType": "rectangle", "title": "Rectangle",
				"stroke": "#1f6feb", "strokeWidth": "2", "fill": "none",
				"rotation": "15",
			},
			Position:  Position{X: 80, Y: 80},
			Size:      &Dimensions{W: 160, H: 96},
			ParentID:  cardSketchesID,
			CreatedAt: now, UpdatedAt: now,
			BuiltIn: true, Seed: seedorigin.Stamp(1),
		},
		{
			// File-backed: no mirrorPath here (this package stays
			// persistence-free) -- atlassvc's own reconcile materializes
			// BuiltInBoardObjectAsset("ink")'s bytes and fills it in.
			ID: objectInkExampleID, Kind: "ink",
			Payload:   map[string]string{"title": "Ink stroke", BoardObjectSeedAssetKey: "ink"},
			Position:  Position{X: 300, Y: 80},
			ParentID:  cardSketchesID,
			CreatedAt: now, UpdatedAt: now,
			BuiltIn: true, Seed: seedorigin.Stamp(1),
		},
		{
			ID: objectImageExampleID, Kind: "image",
			Payload:   map[string]string{"title": "Reference image", BoardObjectSeedAssetKey: "image"},
			Position:  Position{X: 520, Y: 80},
			ParentID:  cardSketchesID,
			CreatedAt: now, UpdatedAt: now,
			BuiltIn: true, Seed: seedorigin.Stamp(1),
		},
		{
			// File-backed pdf (goal 0267): proof that a 'pdf' BoardObject
			// renders through the vendored viewer, pages and all -- two
			// pages, so the viewer's own page controls are exercised by
			// the seed itself.
			ID: objectPdfExampleID, Kind: "pdf",
			Payload:   map[string]string{"title": "Sample document", BoardObjectSeedAssetKey: "pdf"},
			Position:  Position{X: 80, Y: 240},
			Size:      &Dimensions{W: 420, H: 320},
			ParentID:  cardSketchesID,
			CreatedAt: now, UpdatedAt: now,
			BuiltIn: true, Seed: seedorigin.Stamp(1),
		},
		{
			// File-backed drawio (goal 0340): a drawing DELIBERATELY
			// taller than the box it sits in, so the in-frame contract
			// has a permanent live subject. Selected, the wheel pans it,
			// ctrl/pinch zooms it and a drag moves it inside the frame;
			// the chrome band's "Fit" chip is what says it is larger
			// than the frame at rest.
			ID: objectDiagramExampleID, Kind: "diagram",
			Payload:   map[string]string{"title": "Tall diagram", BoardObjectSeedAssetKey: "diagram"},
			Position:  Position{X: 520, Y: 240},
			Size:      &Dimensions{W: 420, H: 320},
			ParentID:  cardSketchesID,
			CreatedAt: now, UpdatedAt: now,
			BuiltIn: true, Seed: seedorigin.Stamp(1),
		},
		{
			// File-backed csv (goal 0239 S2): proof that a 'sheet'
			// BoardObject renders the mirrored-file preview AND that a
			// csv cell quick-edits in place -- double-click a cell of
			// this one to try it; the edit writes this seeded file.
			ID: objectSheetExampleID, Kind: "sheet",
			Payload:   map[string]string{"title": "Sample sheet", BoardObjectSeedAssetKey: "sheet"},
			Position:  Position{X: 740, Y: 80},
			ParentID:  cardSketchesID,
			CreatedAt: now, UpdatedAt: now,
			BuiltIn: true, Seed: seedorigin.Stamp(1),
		},
	}
}

// BuiltInBoardObjectAsset returns the raw file content and extension
// for a file-backed board-object golden's own BoardObjectSeedAssetKey
// value -- pure data, no IO (backend.md's domain-package purity rule).
// atlassvc's own reconcile is the one place with a real captures
// directory to write it into.
func BuiltInBoardObjectAsset(key string) (content, ext string, ok bool) {
	switch key {
	case "ink":
		return seedInkStrokeSVG, ".svg", true
	case "image":
		return seedReferenceImageSVG, ".svg", true
	case "sheet":
		return seedSampleSheetCSV, ".csv", true
	case "pdf":
		return seedSamplePDF, ".pdf", true
	case "diagram":
		return seedTallDiagramDrawio, ".drawio", true
	}
	return "", "", false
}

const (
	// seedInkStrokeSVG is a plain checkmark stroke -- proof that an
	// 'ink' BoardObject renders through the same file-backed mirror
	// door a hand-drawn pencil stroke uses, without depending on a live
	// pointer gesture to produce one.
	seedInkStrokeSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 80" width="120" height="80"><path d="M14 40 L46 66 L106 10" stroke="#1f6feb" stroke-width="10" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>`
	// seedReferenceImageSVG is a plain landscape glyph -- proof that an
	// 'image' BoardObject renders through the same mirrored-file door a
	// pasted/dropped image uses.
	seedReferenceImageSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 120" width="160" height="120"><rect x="4" y="4" width="152" height="112" rx="8" fill="#ffffff" stroke="#1f6feb" stroke-width="4"/><circle cx="48" cy="40" r="14" fill="#9a6700"/><path d="M12 100 L56 60 L84 84 L112 52 L152 96 Z" fill="#238636"/></svg>`
	// seedSampleSheetCSV is a small editable list -- proof that a
	// 'sheet' BoardObject previews a real csv AND that a cell
	// quick-edits in place, writing this same file back.
	seedSampleSheetCSV = "Item,Qty,Notes\nCoffee beans,2,Whole bean\nOat milk,1,\nFilters,100,No. 4\n"
	// seedSamplePDF is a minimal, valid, ASCII-only two-page PDF --
	// proof that a 'pdf' BoardObject renders through the vendored
	// viewer AND that its page controls page (two pages on purpose).
	seedSamplePDF = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 360 240] /Contents 4 0 R /Resources << /Font << /F1 7 0 R >> >> >>
endobj
4 0 obj
<< /Length 50 >>
stream
BT /F1 24 Tf 40 140 Td (Sample PDF - page 1) Tj ET
endstream
endobj
5 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 360 240] /Contents 6 0 R /Resources << /Font << /F1 7 0 R >> >> >>
endobj
6 0 obj
<< /Length 42 >>
stream
BT /F1 24 Tf 40 140 Td (Page 2 of 2) Tj ET
endstream
endobj
7 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>
endobj
xref
0 8
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000121 00000 n 
0000000247 00000 n 
0000000347 00000 n 
0000000473 00000 n 
0000000565 00000 n 
trailer
<< /Size 8 /Root 1 0 R >>
startxref
635
%%EOF
`

	// seedTallDiagramDrawio is a ten-step vertical pipeline: about 2000
	// drawing units tall against a 320px frame, so the seeded object is
	// permanently larger than its box (goal 0340). Plain, uncompressed
	// mxfile XML, the same form GraphViewer decodes on the read path.
	seedTallDiagramDrawio = `<mxfile host="mill"><diagram id="tall" name="Pipeline"><mxGraphModel dx="800" dy="600" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="850" pageHeight="1100" math="0" shadow="0"><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="n0" value="Capture" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;" vertex="1" parent="1"><mxGeometry x="200" y="40" width="240" height="80" as="geometry"/></mxCell><mxCell id="n1" value="Queue" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;" vertex="1" parent="1"><mxGeometry x="200" y="240" width="240" height="80" as="geometry"/></mxCell><mxCell id="e1" style="edgeStyle=orthogonalEdgeStyle;html=1;" edge="1" parent="1" source="n0" target="n1"><mxGeometry relative="1" as="geometry"/></mxCell><mxCell id="n2" value="Guardrail" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;" vertex="1" parent="1"><mxGeometry x="200" y="440" width="240" height="80" as="geometry"/></mxCell><mxCell id="e2" style="edgeStyle=orthogonalEdgeStyle;html=1;" edge="1" parent="1" source="n1" target="n2"><mxGeometry relative="1" as="geometry"/></mxCell><mxCell id="n3" value="Review" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;" vertex="1" parent="1"><mxGeometry x="200" y="640" width="240" height="80" as="geometry"/></mxCell><mxCell id="e3" style="edgeStyle=orthogonalEdgeStyle;html=1;" edge="1" parent="1" source="n2" target="n3"><mxGeometry relative="1" as="geometry"/></mxCell><mxCell id="n4" value="Approve" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;" vertex="1" parent="1"><mxGeometry x="200" y="840" width="240" height="80" as="geometry"/></mxCell><mxCell id="e4" style="edgeStyle=orthogonalEdgeStyle;html=1;" edge="1" parent="1" source="n3" target="n4"><mxGeometry relative="1" as="geometry"/></mxCell><mxCell id="n5" value="Apply" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;" vertex="1" parent="1"><mxGeometry x="200" y="1040" width="240" height="80" as="geometry"/></mxCell><mxCell id="e5" style="edgeStyle=orthogonalEdgeStyle;html=1;" edge="1" parent="1" source="n4" target="n5"><mxGeometry relative="1" as="geometry"/></mxCell><mxCell id="n6" value="Record" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;" vertex="1" parent="1"><mxGeometry x="200" y="1240" width="240" height="80" as="geometry"/></mxCell><mxCell id="e6" style="edgeStyle=orthogonalEdgeStyle;html=1;" edge="1" parent="1" source="n5" target="n6"><mxGeometry relative="1" as="geometry"/></mxCell><mxCell id="n7" value="Notify" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;" vertex="1" parent="1"><mxGeometry x="200" y="1440" width="240" height="80" as="geometry"/></mxCell><mxCell id="e7" style="edgeStyle=orthogonalEdgeStyle;html=1;" edge="1" parent="1" source="n6" target="n7"><mxGeometry relative="1" as="geometry"/></mxCell><mxCell id="n8" value="Verify" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;" vertex="1" parent="1"><mxGeometry x="200" y="1640" width="240" height="80" as="geometry"/></mxCell><mxCell id="e8" style="edgeStyle=orthogonalEdgeStyle;html=1;" edge="1" parent="1" source="n7" target="n8"><mxGeometry relative="1" as="geometry"/></mxCell><mxCell id="n9" value="Archive" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;" vertex="1" parent="1"><mxGeometry x="200" y="1840" width="240" height="80" as="geometry"/></mxCell><mxCell id="e9" style="edgeStyle=orthogonalEdgeStyle;html=1;" edge="1" parent="1" source="n8" target="n9"><mxGeometry relative="1" as="geometry"/></mxCell></root></mxGraphModel></diagram></mxfile>`
)
