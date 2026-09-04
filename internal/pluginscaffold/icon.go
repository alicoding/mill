package pluginscaffold

import (
	"bytes"
	"image"
	"image/color"
	"image/png"

	"golang.org/x/image/font"
	"golang.org/x/image/font/basicfont"
	"golang.org/x/image/math/fixed"
)

// iconSize is the standard's required icon pixel size
// (userdocs/reference/plugin-standard.md rule 13).
const iconSize = 128

// placeholderPalette gives each plugin id a stable, legible tint --
// deterministic so a re-run of the scaffold on the same id draws the
// same icon.
var placeholderPalette = []color.RGBA{
	{R: 31, G: 111, B: 235, A: 255},
	{R: 218, G: 54, B: 51, A: 255},
	{R: 35, G: 134, B: 54, A: 255},
	{R: 130, G: 80, B: 223, A: 255},
	{R: 219, G: 109, B: 40, A: 255},
	{R: 12, G: 140, B: 165, A: 255},
}

// RenderIcon draws a plugin's placeholder icon.png: a rounded,
// tinted square carrying the id's first letter -- a standard-
// conformant starting point (rule 13's 128x128) an author replaces
// with real artwork.
func RenderIcon(id string) []byte {
	img := image.NewRGBA(image.Rect(0, 0, iconSize, iconSize))
	drawRoundedSquare(img, placeholderColor(id))
	drawLetter(img, placeholderLetter(id))
	var buf bytes.Buffer
	_ = png.Encode(&buf, img)
	return buf.Bytes()
}

func placeholderColor(id string) color.RGBA {
	sum := 0
	for _, b := range []byte(id) {
		sum += int(b)
	}
	if len(placeholderPalette) == 0 {
		return color.RGBA{R: 100, G: 100, B: 100, A: 255}
	}
	return placeholderPalette[sum%len(placeholderPalette)]
}

func placeholderLetter(id string) rune {
	for _, r := range id {
		switch {
		case r >= 'a' && r <= 'z':
			return r - ('a' - 'A')
		case r >= 'A' && r <= 'Z':
			return r
		}
	}
	return '?'
}

// drawRoundedSquare fills the image with bg, leaving each corner's
// outer circular sliver transparent.
func drawRoundedSquare(img *image.RGBA, bg color.RGBA) {
	const radius = 20
	b := img.Bounds()
	for y := b.Min.Y; y < b.Max.Y; y++ {
		for x := b.Min.X; x < b.Max.X; x++ {
			if insideRoundedRect(x, y, b.Max.X, b.Max.Y, radius) {
				img.SetRGBA(x, y, bg)
			}
		}
	}
}

func insideRoundedRect(x, y, w, h, r int) bool {
	switch {
	case x < r && y < r:
		return withinRadius(x, y, r, r, r)
	case x >= w-r && y < r:
		return withinRadius(x, y, w-r-1, r, r)
	case x < r && y >= h-r:
		return withinRadius(x, y, r, h-r-1, r)
	case x >= w-r && y >= h-r:
		return withinRadius(x, y, w-r-1, h-r-1, r)
	default:
		return true
	}
}

func withinRadius(x, y, cx, cy, r int) bool {
	dx, dy := x-cx, y-cy
	return dx*dx+dy*dy <= r*r
}

// drawLetter draws one uppercase glyph from the standard library's
// bitmap font, scaled up (nearest-neighbor -- the glyph is a handful
// of pixels, so anything smoother is not worth the code) and centered.
func drawLetter(img *image.RGBA, letter rune) {
	const scale = 8
	glyph := image.NewRGBA(image.Rect(0, 0, 7, 13))
	d := &font.Drawer{
		Dst:  glyph,
		Src:  image.NewUniform(color.White),
		Face: basicfont.Face7x13,
		Dot:  fixed.P(0, 11),
	}
	d.DrawString(string(letter))
	ox := (iconSize - 7*scale) / 2
	oy := (iconSize - 13*scale) / 2
	gb := glyph.Bounds()
	for y := gb.Min.Y; y < gb.Max.Y; y++ {
		for x := gb.Min.X; x < gb.Max.X; x++ {
			if _, _, _, a := glyph.At(x, y).RGBA(); a == 0 {
				continue
			}
			for sy := 0; sy < scale; sy++ {
				for sx := 0; sx < scale; sx++ {
					img.Set(ox+x*scale+sx, oy+y*scale+sy, color.White)
				}
			}
		}
	}
}
