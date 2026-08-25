package atlassvc

import (
	"fmt"

	"github.com/alicoding/mill/internal/domain/atlas"
)

// This file is the ONE place a "shape" board object's Payload (goal
// 0169 slice 5's own producer, frontend/src/atlas/atlasShapeSvg.ts's
// shapePayload -- shapeType/fill/stroke/strokeWidth, every value a
// plain string) maps onto draw.io's style-string vocabulary. It is the
// mirror image of atlaspaste.go's import-side rule ("Detection is a
// deterministic decode ladder, never a heuristic" -- fillColor is never
// read as MEANING on import): here Mill IS the source of the colour,
// so writing it into a style string invents nothing. That asymmetry is
// deliberate, not an oversight -- the constraint governs INTERPRETING
// someone else's colour, not encoding our own.
func shapeVertexCell(o atlas.BoardObject, parentCellID string) (mxCell, bool) {
	style, ok := shapeDrawioStyle(o.Payload["shapeType"], o.Payload["fill"], o.Payload["stroke"], o.Payload["strokeWidth"], o.Payload["rotation"])
	if !ok {
		return mxCell{}, false
	}
	w, h := float64(defaultVertexWidth), float64(defaultVertexHeight)
	if o.Size != nil {
		w, h = o.Size.W, o.Size.H
	}
	return mxCell{
		ID: "o:" + o.ID, Value: o.Payload["title"], Style: style, Vertex: "1", Parent: parentCellID,
		Geometry: &mxGeometry{X: o.Position.X, Y: o.Position.Y, W: w, H: h, As: "geometry"},
	}, true
}

// shapeDrawioStyle covers rectangle/ellipse -- the two shape types with
// a real vertex box. Arrow has none (see this package's atlasboarddrawio.go
// doc comment for why) and reports ok=false so its caller names it
// skipped instead of guessing at a shape. rotation rides the same
// trust-the-payload-string convention strokeWidth already uses (this
// package is the source of the value, so no parse/round-trip is
// needed) -- omitted entirely when unset or "0" so an unrotated shape's
// exported style matches what it was before this field existed.
func shapeDrawioStyle(shapeType, fill, stroke, strokeWidth, rotation string) (string, bool) {
	var base string
	switch shapeType {
	case "rectangle":
		base = "rounded=0;whiteSpace=wrap;html=1;"
	case "ellipse":
		base = "ellipse;whiteSpace=wrap;html=1;"
	default:
		return "", false
	}
	if fill == "" {
		fill = "none"
	}
	if stroke == "" {
		stroke = "none"
	}
	style := fmt.Sprintf("%sfillColor=%s;strokeColor=%s;", base, fill, stroke)
	if strokeWidth != "" {
		style += "strokeWidth=" + strokeWidth + ";"
	}
	if rotation != "" && rotation != "0" {
		style += "rotation=" + rotation + ";"
	}
	return style, true
}

func shapeSkipName(o atlas.BoardObject) string {
	title := o.Payload["title"]
	if title == "" {
		title = "shape"
	}
	return title + " (freeform arrow)"
}

func boardObjectSkipName(o atlas.BoardObject) string {
	title := o.Payload["title"]
	if title == "" {
		title = o.Kind
	}
	return fmt.Sprintf("%s (%s)", title, o.Kind)
}
