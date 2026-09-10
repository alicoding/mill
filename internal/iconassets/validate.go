package main

import (
	"bytes"
	"encoding/json"
	"encoding/xml"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"golang.org/x/net/html"
)

type pngContract struct {
	path       string
	size       int
	fullBleed  bool
	template   bool
	appPalette bool
}

func validateAssets(root string, packaged bool) error {
	if err := validateMarkFile(filepath.Join(root, markSource)); err != nil {
		return err
	}
	for _, path := range []string{
		"frontend/public/mill.svg",
		"build/appicon.icon/Assets/mill-mark.svg",
	} {
		if err := validateXML(filepath.Join(root, path)); err != nil {
			return err
		}
	}
	if err := validateIconComposer(root); err != nil {
		return err
	}

	contracts := []pngContract{
		{"build/appicon.png", 1024, false, false, true},
		{"build/ios/icon.png", 1024, true, false, true},
		{"build/tray-template.png", 44, false, true, false},
		{"frontend/src/app/millicon.png", 1024, false, false, true},
		{"frontend/public/icons/icon-192.png", 192, false, false, true},
		{"frontend/public/icons/icon-512.png", 512, false, false, true},
		{"frontend/public/icons/icon-maskable-512.png", 512, true, false, true},
		{"frontend/public/icons/apple-touch-icon-180.png", 180, true, false, true},
		{"examples/browser-extension/icons/icon-16.png", 16, false, false, false},
		{"examples/browser-extension/icons/icon-32.png", 32, false, false, true},
		{"examples/browser-extension/icons/icon-48.png", 48, false, false, true},
		{"examples/browser-extension/icons/icon-128.png", 128, false, false, true},
	}
	for _, contract := range contracts {
		if _, err := validatePNG(filepath.Join(root, contract.path), contract); err != nil {
			return err
		}
	}
	if err := sameBytes(root, "build/appicon.png", "frontend/src/app/millicon.png"); err != nil {
		return err
	}
	if err := validatePWA(root); err != nil {
		return err
	}
	if err := validateBrowserExtension(root); err != nil {
		return err
	}
	if 0.72*45 > 40 {
		return fmt.Errorf("maskable foreground exceeds the centered 40%%-radius safe circle")
	}
	if packaged {
		return validatePackaged(root)
	}
	return nil
}

func validateMarkFile(path string) error {
	// #nosec G304 -- path is the fixed repository-owned mark source.
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer func() { _ = f.Close() }()

	var signatures []string
	decoder := xml.NewDecoder(f)
	for {
		token, err := decoder.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			return fmt.Errorf("parse %s: %w", path, err)
		}
		start, ok := token.(xml.StartElement)
		if !ok || start.Name.Local == "svg" {
			continue
		}
		attrs := make([]string, 0, len(start.Attr))
		for _, attr := range start.Attr {
			attrs = append(attrs, attr.Name.Local+"="+attr.Value)
		}
		sort.Strings(attrs)
		signatures = append(signatures, start.Name.Local+":"+strings.Join(attrs, ","))
	}
	want := []string{
		"line:stroke-linecap=round,stroke-width=5,stroke=#8b949e,x1=14,x2=33,y1=50,y2=50",
		"line:stroke-linecap=round,stroke-width=5,stroke=#8b949e,x1=67,x2=86,y1=50,y2=50",
		"circle:cx=14,cy=50,fill=#0969DA,r=9",
		"circle:cx=86,cy=50,fill=#D4590B,r=9",
		"rect:fill=none,height=27,rx=5.5,stroke-width=7.5,stroke=#3FA39E,transform=rotate(45 50 50),width=27,x=36.5,y=36.5",
	}
	if fmt.Sprint(signatures) != fmt.Sprint(want) {
		return fmt.Errorf("%s geometry or palette drifted: got %v", path, signatures)
	}
	return nil
}

func validateXML(path string) error {
	// #nosec G304 -- path is a repository-owned generated SVG.
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer func() { _ = f.Close() }()
	decoder := xml.NewDecoder(f)
	for {
		_, err := decoder.Token()
		if err == io.EOF {
			return nil
		}
		if err != nil {
			return fmt.Errorf("parse %s: %w", path, err)
		}
	}
}

func validateIconComposer(root string) error {
	assets, err := os.ReadDir(filepath.Join(root, "build/appicon.icon/Assets"))
	if err != nil {
		return err
	}
	if len(assets) != 1 || assets[0].Name() != "mill-mark.svg" {
		return fmt.Errorf("icon Composer assets must contain only mill-mark.svg")
	}
	canonicalPath := filepath.Join(root, markSource)
	composerPath := filepath.Join(root, "build/appicon.icon/Assets/mill-mark.svg")
	// #nosec G304 -- both paths are fixed repository-owned identity sources.
	canonical, err := os.ReadFile(canonicalPath)
	if err != nil {
		return err
	}
	// #nosec G304 -- both paths are fixed repository-owned identity sources.
	composer, err := os.ReadFile(composerPath)
	if err != nil {
		return err
	}
	if !bytes.Equal(canonical, composer) {
		return fmt.Errorf("%s differs from canonical %s", composerPath, canonicalPath)
	}
	path := filepath.Join(root, "build/appicon.icon/icon.json")
	// #nosec G304 -- path is the fixed repository-owned Icon Composer manifest.
	data, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	if bytes.Contains(bytes.ToLower(data), []byte("wails")) {
		return fmt.Errorf("%s still contains scaffold identity", path)
	}
	var doc struct {
		Fill struct {
			Solid string `json:"solid"`
		} `json:"fill"`
		Groups []struct {
			Layers []struct {
				ImageName string `json:"image-name"`
				Name      string `json:"name"`
				Position  struct {
					Scale float64 `json:"scale"`
				} `json:"position"`
			} `json:"layers"`
		} `json:"groups"`
	}
	if err := json.Unmarshal(data, &doc); err != nil {
		return fmt.Errorf("parse %s: %w", path, err)
	}
	if doc.Fill.Solid != "srgb:0.05098,0.06667,0.09020,1.00000" {
		return fmt.Errorf("%s background = %q", path, doc.Fill.Solid)
	}
	if len(doc.Groups) != 1 || len(doc.Groups[0].Layers) != 1 {
		return fmt.Errorf("%s must contain one foreground layer", path)
	}
	layer := doc.Groups[0].Layers[0]
	if layer.ImageName != "mill-mark.svg" || layer.Name != "mill-mark" || layer.Position.Scale != 0.72 {
		return fmt.Errorf("%s foreground = %+v", path, layer)
	}
	return nil
}

func validatePNG(path string, contract pngContract) (image.Image, error) {
	// #nosec G304 -- callers supply repository-owned generated PNG paths.
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer func() { _ = f.Close() }()
	img, err := png.Decode(f)
	if err != nil {
		return nil, fmt.Errorf("decode %s: %w", path, err)
	}
	if img.Bounds().Dx() != contract.size || img.Bounds().Dy() != contract.size {
		return nil, fmt.Errorf("%s dimensions = %v, want %dx%d", path, img.Bounds(), contract.size, contract.size)
	}
	if contract.fullBleed {
		if err := requireOpaque(path, img); err != nil {
			return nil, err
		}
	} else if alphaAt(img, 0, 0) != 0 {
		return nil, fmt.Errorf("%s corner is not transparent", path)
	}
	if contract.template {
		if err := requireTemplate(path, img); err != nil {
			return nil, err
		}
	}
	if contract.appPalette {
		if err := requirePalette(path, img); err != nil {
			return nil, err
		}
	}
	return img, nil
}

func requireOpaque(path string, img image.Image) error {
	for y := img.Bounds().Min.Y; y < img.Bounds().Max.Y; y++ {
		for x := img.Bounds().Min.X; x < img.Bounds().Max.X; x++ {
			if alphaAt(img, x, y) != 0xffff {
				return fmt.Errorf("%s has transparent pixel at %d,%d", path, x, y)
			}
		}
	}
	return nil
}

func requireTemplate(path string, img image.Image) error {
	opaque := 0
	for y := img.Bounds().Min.Y; y < img.Bounds().Max.Y; y++ {
		for x := img.Bounds().Min.X; x < img.Bounds().Max.X; x++ {
			r, g, b, a := img.At(x, y).RGBA()
			if a == 0 {
				continue
			}
			opaque++
			if r != 0 || g != 0 || b != 0 {
				return fmt.Errorf("%s contains non-black foreground at %d,%d", path, x, y)
			}
		}
	}
	center := img.Bounds().Dx() / 2
	if opaque == 0 || alphaAt(img, center, center) != 0 {
		return fmt.Errorf("%s does not preserve the hollow template mark", path)
	}
	return nil
}

func requirePalette(path string, img image.Image) error {
	want := []color.RGBA{{0x09, 0x69, 0xda, 0xff}, {0xd4, 0x59, 0x0b, 0xff}, {0x3f, 0xa3, 0x9e, 0xff}}
	found := make([]bool, len(want))
	for y := img.Bounds().Min.Y; y < img.Bounds().Max.Y; y++ {
		for x := img.Bounds().Min.X; x < img.Bounds().Max.X; x++ {
			got := color.RGBAModel.Convert(img.At(x, y)).(color.RGBA)
			for i, expected := range want {
				if got.A >= 0xc0 && channelDistance(got, expected) <= 36 {
					found[i] = true
				}
			}
		}
	}
	for i, ok := range found {
		if !ok {
			return fmt.Errorf("%s does not contain palette color %#v", path, want[i])
		}
	}
	return nil
}

func channelDistance(got, want color.RGBA) int {
	return abs(int(got.R)-int(want.R)) + abs(int(got.G)-int(want.G)) + abs(int(got.B)-int(want.B))
}

func abs(value int) int {
	if value < 0 {
		return -value
	}
	return value
}

func alphaAt(img image.Image, x, y int) uint32 {
	_, _, _, alpha := img.At(x, y).RGBA()
	return alpha
}

func sameBytes(root, first, second string) error {
	// #nosec G304 -- callers supply fixed repository-owned asset paths.
	a, err := os.ReadFile(filepath.Join(root, first))
	if err != nil {
		return err
	}
	// #nosec G304 -- callers supply fixed repository-owned asset paths.
	b, err := os.ReadFile(filepath.Join(root, second))
	if err != nil {
		return err
	}
	if !bytes.Equal(a, b) {
		return fmt.Errorf("%s and %s differ", first, second)
	}
	return nil
}

func validatePWA(root string) error {
	type icon struct {
		Src     string `json:"src"`
		Sizes   string `json:"sizes"`
		Type    string `json:"type"`
		Purpose string `json:"purpose"`
	}
	var manifest struct {
		Icons []icon `json:"icons"`
	}
	path := filepath.Join(root, "frontend/public/manifest.webmanifest")
	// #nosec G304 -- path is the fixed repository-owned web manifest.
	data, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	if err := json.Unmarshal(data, &manifest); err != nil {
		return fmt.Errorf("parse %s: %w", path, err)
	}
	want := map[string]icon{
		"/icons/icon-192.png":          {"/icons/icon-192.png", "192x192", "image/png", "any"},
		"/icons/icon-512.png":          {"/icons/icon-512.png", "512x512", "image/png", "any"},
		"/icons/icon-maskable-512.png": {"/icons/icon-maskable-512.png", "512x512", "image/png", "maskable"},
	}
	if len(manifest.Icons) != len(want) {
		return fmt.Errorf("%s icons = %d, want %d", path, len(manifest.Icons), len(want))
	}
	for _, got := range manifest.Icons {
		expected, ok := want[got.Src]
		if !ok || got != expected {
			return fmt.Errorf("%s icon entry = %+v", path, got)
		}
		if _, err := os.Stat(filepath.Join(root, "frontend/public", strings.TrimPrefix(got.Src, "/"))); err != nil {
			return err
		}
	}
	return validateAppleTouchLink(filepath.Join(root, "frontend/index.html"))
}

func validateAppleTouchLink(path string) error {
	// #nosec G304 -- path is the fixed repository-owned frontend entry point.
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer func() { _ = f.Close() }()
	doc, err := html.Parse(f)
	if err != nil {
		return fmt.Errorf("parse %s: %w", path, err)
	}
	var walk func(*html.Node) bool
	walk = func(node *html.Node) bool {
		if isAppleTouchLink(node) {
			return true
		}
		for child := node.FirstChild; child != nil; child = child.NextSibling {
			if walk(child) {
				return true
			}
		}
		return false
	}
	if !walk(doc) {
		return fmt.Errorf("%s does not reference the generated Apple touch icon", path)
	}
	return nil
}

func isAppleTouchLink(node *html.Node) bool {
	if node.Type != html.ElementNode || node.Data != "link" {
		return false
	}
	attrs := map[string]string{}
	for _, attr := range node.Attr {
		attrs[attr.Key] = attr.Val
	}
	return attrs["rel"] == "apple-touch-icon" && attrs["href"] == "/icons/apple-touch-icon-180.png"
}

func validateBrowserExtension(root string) error {
	type action struct {
		DefaultIcon map[string]string `json:"default_icon"`
	}
	var manifest struct {
		Icons  map[string]string `json:"icons"`
		Action action            `json:"action"`
	}
	path := filepath.Join(root, "examples/browser-extension/manifest.json")
	// #nosec G304 -- path is the fixed repository-owned extension manifest.
	data, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	if err := json.Unmarshal(data, &manifest); err != nil {
		return fmt.Errorf("parse %s: %w", path, err)
	}
	wantIcons := map[string]string{"16": "icons/icon-16.png", "32": "icons/icon-32.png", "48": "icons/icon-48.png", "128": "icons/icon-128.png"}
	wantAction := map[string]string{"16": "icons/icon-16.png", "32": "icons/icon-32.png"}
	if fmt.Sprint(manifest.Icons) != fmt.Sprint(wantIcons) || fmt.Sprint(manifest.Action.DefaultIcon) != fmt.Sprint(wantAction) {
		return fmt.Errorf("%s icon declarations do not match generated assets", path)
	}
	for _, relative := range wantIcons {
		if _, err := os.Stat(filepath.Join(filepath.Dir(path), relative)); err != nil {
			return err
		}
	}
	return nil
}
