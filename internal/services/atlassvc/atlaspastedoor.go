package atlassvc

import (
	"github.com/alicoding/mill/internal/domain/atlas"
	"github.com/alicoding/mill/internal/domain/typedfield"
)

// The paste DOOR itself (docs/goals/0218): the wire-shape result, the
// ordered recognizer chain, and the one bound entry point -- split
// from atlaspastebuild.go, which owns the drawio-model-to-primitives
// conversion the first recognizers delegate to.

// PasteResult reports what a paste became; Recognized=false means the
// text wasn't diagram-shaped and nothing was created. SkippedPages
// names any multi-page source page that failed to decode -- non-empty
// only when Recognized is also true, since a page can only be skipped
// out of a file that WAS recognized as one.
type PasteResult struct {
	Recognized bool
	Cards      int
	Links      int
	Tables     int
	// Images counts a paste landing an "image" board object (goal 0179
	// Slice 0, atlaspasteimage.go) -- always 0 or 1, since a single
	// paste names exactly one path or URL.
	Images int
	// PluginObjects counts a paste landing a runtime plugin's claimed
	// board object (docs/goals/0251, atlaspasteplugin.go) -- always 0
	// or 1, same single-payload property Images documents.
	PluginObjects int
	SkippedPages  []string
}

// WirePasteListWrites installs the Configure-owned write seams the
// table conversion runs through (wired from the composition root,
// backend.md's injected-func rule).
//
//wails:ignore
func (a *AtlasService) WirePasteListWrites(factory func(label string, columns []typedfield.Field) (string, error), appendRow func(listID string, values map[string]string) error) {
	a.pasteListFactory = factory
	a.pasteRowAppender = appendRow
}

// pasteRecognizer is one entry in the paste door's own ordered
// recognizer chain (docs/goals/0218). Each tries to recognize (text,
// html) and, on a match, performs the create and returns ok=true;
// ok=false means "not this shape," letting PasteToBoard try the next
// entry. Uniform signature (both text and html handed to every entry,
// even the ones that only read one) so the chain below stays a plain
// slice literal -- adding a clipboard shape is one new function plus
// one new line in pasteRecognizers, never a re-architecture.
type pasteRecognizer func(a *AtlasService, text, html, parentID string, pos atlas.Position) (PasteResult, bool, error)

// pasteRecognizers is the paste door's one ordered chain: drawio XML
// (a diagramming tool's own clipboard payload) -> HTML table (an M365
// app's copied table) -> TSV (a spreadsheet range) -> an image path/URL
// (atlaspasteimage.go, goal 0179 Slice 0). The image entry runs LAST of
// the Go-side recognizers -- each earlier entry demands specific markup
// (mxGraph XML, an HTML <table>, tab-separated columns) a bare path or
// URL string never carries, so checking it first would cost every other
// shape a wasted url.Parse/os.Stat for nothing; ordering it after them
// costs nothing since their own detection already rejects a bare
// string immediately. recognizePluginURLPaste (docs/goals/0251,
// atlaspasteplugin.go) runs after image so a pasted image URL still
// lands as an image -- a runtime plugin's claim can extend the chain
// but never shadow a built-in shape. When NONE recognize the payload,
// the frontend's own paste handler lands the pasted content as a note
// at the pointer instead -- the named last resort, never a card
// (docs/goals/0179, 0218).
var pasteRecognizers = []pasteRecognizer{
	recognizeDrawioPaste,
	recognizeHTMLTablePaste,
	recognizeTSVPaste,
	recognizeImagePaste,
	recognizePluginURLPaste,
}

// PasteToBoard converts understood clipboard content into entities
// under parentID, starting placement at (x, y). A user's own paste is
// a direct edit -- ungated, like every direct create.
func (a *AtlasService) PasteToBoard(text, html, parentID string, x, y float64) (PasteResult, error) {
	pos := atlas.Position{X: x, Y: y}
	// A multi-table/multi-card paste lands as ONE undo step (ADR-0044
	// decision 2's "multi-paste landing") -- every entity this call
	// creates already journals through CreateBoardObject/CreateCard/
	// CreateLink individually; grouping them here is the only change
	// needed.
	a.BeginUndoMark()
	defer a.EndUndoMark()
	for _, recognize := range pasteRecognizers {
		if res, ok, err := recognize(a, text, html, parentID, pos); ok {
			return res, err
		}
	}
	return PasteResult{}, nil
}
