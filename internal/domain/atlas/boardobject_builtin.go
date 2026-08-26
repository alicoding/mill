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
			ID: objectDiagramExampleID, Kind: "diagram",
			Payload:   map[string]string{"title": "System overview", BoardObjectSeedAssetKey: "diagram"},
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
	case "diagram":
		return seedDiagramMermaid, ".mmd", true
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
	// seedDiagramMermaid is a small flowchart naming three of the
	// seeded cards -- proof that a 'diagram' BoardObject renders
	// through the same vendored mermaid host a diagram card's own page
	// unit uses.
	seedDiagramMermaid = "graph TD\n  Engagement[The engagement] --> Discovery[Discovery workstream]\n  Engagement --> Records[Client records]\n"
)
