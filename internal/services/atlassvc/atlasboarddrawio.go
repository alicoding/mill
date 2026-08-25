package atlassvc

import (
	"encoding/xml"
	"fmt"

	"github.com/alicoding/mill/internal/adapters/fileread"
	"github.com/alicoding/mill/internal/domain/atlas"
)

// This file is atlaspastebuild.go's own INVERSE (goal 0194's export
// slice): Mill's own cards/links/containment become an mxFile a real
// draw.io -- or Mill's own PasteToBoard -- can open. Marshal support
// (XMLName, the omitempty tags, mxGeometry.As) lives on atlaspaste.go's
// mxCell/mxGeometry/mxDiagram/mxFile structs; this file only builds
// values against that same wire shape, never a second writer type.
//
// Scope, named once: a "board" is spaceID's own card SUBTREE -- every
// descendant reachable by ParentID at any depth (boardSubtree below),
// the exact shape pasteDiagram/containmentOrder build going the other
// way. rectangle/ellipse shape objects export as styled vertex cells
// (atlasboarddrawiostyle.go owns the style-string mapping). Three
// kinds are deliberately OUT of scope for v1, named in Skipped rather
// than silently dropped: ink and image board objects (board-local,
// file-backed content this format has no faithful cell for), and
// freeform arrow shapes (draw.io models a floating arrow as an edge
// with two geometry points and no source/target cell -- Mill's own
// importer has no inverse for that shape, so a re-imported arrow would
// just vanish, the exact silent loss goal 0194 forbids elsewhere). A
// "diagram" board object (a dropped .drawio/.mmd/.mermaid file
// reference, goal 0179 S2) embeds its own mirrored file as an
// additional page when that file parses as a draw.io source, else it
// is named skipped too -- never rendered as a plain vertex.
const (
	drawioRootLayerID   = "1"
	defaultVertexWidth  = 160
	defaultVertexHeight = 60
)

// BoardDrawioExport reports what ExportBoardAsDrawio produced --
// mirrors PasteResult's own "counts + skipped, never silent" shape for
// the reverse direction.
type BoardDrawioExport struct {
	XML     string
	Cards   int
	Links   int
	Shapes  int
	Pages   int
	Skipped []string
}

// ExportBoardAsDrawio serializes spaceID's own board (its card subtree,
// any depth, plus its shape/diagram board objects) into a .drawio file.
// spaceID == "" exports the top-level board. Read-only.
func (a *AtlasService) ExportBoardAsDrawio(spaceID string) (BoardDrawioExport, error) {
	cards, objects, links := boardSubtree(a.Cards(), a.Objects(), a.Links(), spaceID)
	cardIDs := make(map[string]bool, len(cards))
	for _, c := range cards {
		cardIDs[c.ID] = true
	}

	cells := make([]mxCell, 0, 2+len(cards)+len(links))
	cells = append(cells, mxCell{ID: "0"}, mxCell{ID: drawioRootLayerID, Parent: "0"})
	for _, c := range cards {
		cells = append(cells, cardVertexCell(c, cardParentCellID(c.ParentID, cardIDs), hasChildCard(cards, c.ID)))
	}
	for _, l := range links {
		cells = append(cells, linkEdgeCell(l))
	}

	shapeCount := 0
	var skipped []string
	pages := []mxDiagram{{ID: "board", Name: "Board", Inline: &mxGraphModel{Cells: cells}}}
	for _, o := range objects {
		switch o.Kind {
		case "shape":
			cell, ok := shapeVertexCell(o, cardParentCellID(o.ParentID, cardIDs))
			if !ok {
				skipped = append(skipped, shapeSkipName(o))
				continue
			}
			pages[0].Inline.Cells = append(pages[0].Inline.Cells, cell)
			shapeCount++
		case "diagram":
			embedded, ok, name := embedDiagramMirror(o)
			if !ok {
				skipped = append(skipped, name)
				continue
			}
			pages = append(pages, embedded...)
		default:
			skipped = append(skipped, boardObjectSkipName(o))
		}
	}

	data, err := xml.Marshal(mxFile{Host: "mill", Diagrams: pages})
	if err != nil {
		return BoardDrawioExport{}, fmt.Errorf("export board as drawio: %w", err)
	}
	return BoardDrawioExport{
		XML: xml.Header + string(data),
		Cards: len(cards), Links: len(links), Shapes: shapeCount, Pages: len(pages),
		Skipped: skipped,
	}, nil
}

// boardSubtree collects every card/link/board-object reachable from
// spaceID by ParentID at any depth -- the inverse of pasteDiagram's own
// containmentOrder tree-building. Pure (no locking) so it's directly
// unit-testable against plain slices; ExportBoardAsDrawio supplies the
// already-live (tombstone-excluded) slices via a.Cards()/a.Objects()/
// a.Links().
func boardSubtree(allCards []atlas.Card, allObjects []atlas.BoardObject, allLinks []atlas.Link, spaceID string) ([]atlas.Card, []atlas.BoardObject, []atlas.Link) {
	byParent := make(map[string][]atlas.Card, len(allCards))
	for _, c := range allCards {
		byParent[c.ParentID] = append(byParent[c.ParentID], c)
	}

	included := make(map[string]bool)
	var cards []atlas.Card
	queue := []string{spaceID}
	for len(queue) > 0 {
		id := queue[0]
		queue = queue[1:]
		for _, c := range byParent[id] {
			if included[c.ID] {
				continue
			}
			included[c.ID] = true
			cards = append(cards, c)
			queue = append(queue, c.ID)
		}
	}

	var objects []atlas.BoardObject
	for _, o := range allObjects {
		if o.ParentID == spaceID || included[o.ParentID] {
			objects = append(objects, o)
		}
	}

	var links []atlas.Link
	for _, l := range allLinks {
		if included[l.FromCardID] && included[l.ToCardID] {
			links = append(links, l)
		}
	}
	return cards, objects, links
}

// cardParentCellID maps a Mill ParentID onto the mxCell it should nest
// under: another card in THIS export's own scope becomes its own
// vertex cell (prefixed "c:"), anything else -- spaceID itself, or the
// root "" -- is the export's own top layer.
func cardParentCellID(parentID string, cardIDs map[string]bool) string {
	if cardIDs[parentID] {
		return "c:" + parentID
	}
	return drawioRootLayerID
}

func hasChildCard(cards []atlas.Card, id string) bool {
	for _, c := range cards {
		if c.ParentID == id {
			return true
		}
	}
	return false
}

// cardVertexCell is splitVertexText's own inverse: Note rejoins onto
// Value as a second line when present, so a re-import splits them right
// back apart. A card with children gets draw.io's "swimlane" style (a
// real container look when opened in draw.io itself) -- style is never
// read by Mill's own importer, so this is a presentation nicety, not
// load-bearing for the round trip.
func cardVertexCell(c atlas.Card, parentCellID string, isContainer bool) mxCell {
	value := c.Title
	if c.Note != "" {
		value = c.Title + "\n" + c.Note
	}
	x, y := 0.0, 0.0
	if c.Position != nil {
		x, y = c.Position.X, c.Position.Y
	}
	w, h := float64(defaultVertexWidth), float64(defaultVertexHeight)
	if c.Size != nil {
		w, h = c.Size.W, c.Size.H
	}
	style := "rounded=0;whiteSpace=wrap;html=1;"
	if isContainer {
		style = "swimlane;whiteSpace=wrap;html=1;"
	}
	return mxCell{
		ID: "c:" + c.ID, Value: value, Style: style, Vertex: "1", Parent: parentCellID,
		Geometry: &mxGeometry{X: x, Y: y, W: w, H: h, As: "geometry"},
	}
}

// linkEdgeCell always parents an edge at the export's own top layer --
// mxGraph never requires an edge to share its endpoints' container, and
// pasteEdges (the import side) reads Source/Target by id, never Parent.
func linkEdgeCell(l atlas.Link) mxCell {
	return mxCell{ID: "e:" + l.ID, Value: l.Label, Edge: "1", Parent: drawioRootLayerID, Source: "c:" + l.FromCardID, Target: "c:" + l.ToCardID}
}

// embedDiagramMirror resolves a "diagram" board object's own mirrored
// file (Payload["mirrorPath"], goal 0179 S2's file-drop door) into this
// export's own additional page(s) -- reusing atlaspaste.go's SAME
// decode ladder the paste path already runs, so a mirror that parses
// here is guaranteed to also re-import cleanly. A multi-page mirror
// unmarshals directly as its own mxFile first, so its page names
// survive; only a bare mxGraphModel/compressed source falls through to
// the full decode ladder. A vanished or non-draw.io mirror (a
// .mmd/.mermaid file, for instance) is reported to the caller as
// skipped, never silently dropped.
func embedDiagramMirror(o atlas.BoardObject) ([]mxDiagram, bool, string) {
	title := o.Payload["title"]
	if title == "" {
		title = "diagram"
	}
	path := o.Payload["mirrorPath"]
	if path == "" {
		return nil, false, title + " (no mirrored file)"
	}
	raw, err := fileread.Read(path)
	if err != nil {
		return nil, false, title + " (file not found)"
	}

	var f mxFile
	if xml.Unmarshal([]byte(raw), &f) == nil && len(f.Diagrams) > 0 {
		return renamedPages(f.Diagrams, title), true, ""
	}
	if model, _, ok := decodeDiagramText(raw); ok {
		return []mxDiagram{{Name: title, Inline: &model}}, true, ""
	}
	return nil, false, title + " (not a draw.io source)"
}

func renamedPages(diagrams []mxDiagram, title string) []mxDiagram {
	out := make([]mxDiagram, len(diagrams))
	for i, d := range diagrams {
		name := d.Name
		if name == "" {
			name = fmt.Sprintf("Page %d", i+1)
		}
		out[i] = d
		out[i].Name = fmt.Sprintf("%s — %s", title, name)
	}
	return out
}
