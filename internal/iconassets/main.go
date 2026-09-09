// Command iconassets renders and validates Mill's checked-in identity assets.
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"encoding/xml"
	"errors"
	"flag"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

const (
	rendererName    = "rsvg-convert"
	rendererVersion = "2.62.3"
	markSource      = "build/branding/mill-mark.svg"
)

type markDocument struct {
	XMLName xml.Name `xml:"svg"`
	ViewBox string   `xml:"viewBox,attr"`
	Inner   string   `xml:",innerxml"`
}

type renderTarget struct {
	path string
	size int
	svg  string
}

func main() {
	check := flag.Bool("check", false, "validate committed source assets without regenerating")
	checkPackaged := flag.Bool("check-packaged", false, "also validate Wails platform outputs")
	checkIOS := flag.Bool("check-ios", false, "also validate the staged Wails iOS icon output")
	flag.Parse()

	root, err := repositoryRoot()
	if err == nil && !*check {
		err = generate(root)
	}
	if err == nil {
		err = validateAssets(root, *checkPackaged)
	}
	if err == nil && *checkIOS {
		err = validateIOSGenerator(root)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "icon-assets:", err)
		os.Exit(1)
	}
	fmt.Println("icon-assets: ok")
}

func repositoryRoot() (string, error) {
	root, err := os.Getwd()
	if err != nil {
		return "", err
	}
	if _, err := os.Stat(filepath.Join(root, "go.mod")); err != nil {
		return "", errors.New("run from the repository root")
	}
	return root, nil
}

func generate(root string) error {
	mark, source, err := loadMark(filepath.Join(root, markSource))
	if err != nil {
		return err
	}
	renderer, err := pinnedRenderer()
	if err != nil {
		return err
	}

	appTile := tileSVG(mark.Inner, true)
	fullBleed := tileSVG(mark.Inner, false)
	tray := traySVG(mark.Inner)
	if err := writeIfChanged(filepath.Join(root, "frontend/public/mill.svg"), []byte(appTile)); err != nil {
		return err
	}
	if err := writeIfChanged(filepath.Join(root, "build/appicon.icon/Assets/mill-mark.svg"), source); err != nil {
		return err
	}
	if err := writeIfChanged(filepath.Join(root, "build/appicon.icon/icon.json"), []byte(iconComposerJSON)); err != nil {
		return err
	}

	targets := []renderTarget{
		{"build/appicon.png", 1024, appTile},
		{"build/ios/icon.png", 1024, fullBleed},
		{"build/tray-template.png", 44, tray},
		{"frontend/src/app/millicon.png", 1024, appTile},
		{"frontend/public/icons/icon-192.png", 192, appTile},
		{"frontend/public/icons/icon-512.png", 512, appTile},
		{"frontend/public/icons/icon-maskable-512.png", 512, fullBleed},
		{"frontend/public/icons/apple-touch-icon-180.png", 180, fullBleed},
		{"examples/browser-extension/icons/icon-16.png", 16, appTile},
		{"examples/browser-extension/icons/icon-32.png", 32, appTile},
		{"examples/browser-extension/icons/icon-48.png", 48, appTile},
		{"examples/browser-extension/icons/icon-128.png", 128, appTile},
	}
	for _, target := range targets {
		if err := render(renderer, root, target); err != nil {
			return err
		}
	}
	return nil
}

func loadMark(path string) (markDocument, []byte, error) {
	// #nosec G304 -- path is the fixed repository-owned mark source.
	source, err := os.ReadFile(path)
	if err != nil {
		return markDocument{}, nil, err
	}
	var mark markDocument
	if err := xml.Unmarshal(source, &mark); err != nil {
		return markDocument{}, nil, fmt.Errorf("parse %s: %w", path, err)
	}
	if mark.ViewBox != "0 0 100 100" {
		return markDocument{}, nil, fmt.Errorf("%s viewBox = %q", path, mark.ViewBox)
	}
	return mark, source, nil
}

func pinnedRenderer() (string, error) {
	path, err := exec.LookPath(rendererName)
	if err != nil {
		return "", fmt.Errorf("%s %s is required: %w", rendererName, rendererVersion, err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	// #nosec G204 -- path is the resolved executable for the fixed rendererName.
	out, err := exec.CommandContext(ctx, path, "--version").Output()
	if err != nil {
		return "", fmt.Errorf("read %s version: %w", rendererName, err)
	}
	want := "rsvg-convert version " + rendererVersion
	if !strings.HasPrefix(string(out), want+"\n") {
		return "", fmt.Errorf("%s is required, got %q", want, strings.TrimSpace(string(out)))
	}
	return path, nil
}

func tileSVG(mark string, rounded bool) string {
	rect := `<rect x="0" y="0" width="100" height="100" fill="url(#bg)"/>`
	if rounded {
		rect = `<rect x="1" y="1" width="98" height="98" rx="22" fill="url(#bg)"/>`
	}
	return fmt.Sprintf(`<svg width="128" height="128" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
  <!-- Generated from build/branding/mill-mark.svg by task icons:regen. -->
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#1c2330"/><stop offset="1" stop-color="#0d1117"/>
    </linearGradient>
  </defs>
  %s
  <g transform="translate(50 50) scale(0.72) translate(-50 -50)">%s</g>
</svg>
`, rect, mark)
}

func traySVG(mark string) string {
	return fmt.Sprintf(`<svg width="44" height="44" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
  <!-- Generated from build/branding/mill-mark.svg by task icons:regen. -->
  <defs>
    <filter id="template-color" color-interpolation-filters="sRGB">
      <feColorMatrix type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0"/>
    </filter>
  </defs>
  <g transform="translate(50 50) scale(0.90) translate(-50 -50)" filter="url(#template-color)">%s</g>
</svg>
`, mark)
}

func render(renderer, root string, target renderTarget) error {
	destination := filepath.Join(root, target.path)
	// #nosec G301 -- generated repository assets need normal directory traversal.
	if err := os.MkdirAll(filepath.Dir(destination), 0o755); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(destination), ".icon-*.png")
	if err != nil {
		return err
	}
	tmpPath := tmp.Name()
	if err := tmp.Close(); err != nil {
		return err
	}
	defer func() { _ = os.Remove(tmpPath) }()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	// #nosec G204 -- renderer is pinned and target arguments are internal constants.
	cmd := exec.CommandContext(ctx, renderer, "--format=png", "--width", strconv.Itoa(target.size), "--height", strconv.Itoa(target.size), "--output", tmpPath)
	cmd.Stdin = strings.NewReader(target.svg)
	if out, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("render %s: %w: %s", target.path, err, strings.TrimSpace(string(out)))
	}
	// #nosec G304 -- tmpPath was created by os.CreateTemp above.
	data, err := os.ReadFile(tmpPath)
	if err != nil {
		return err
	}
	return writeIfChanged(destination, data)
}

func writeIfChanged(path string, data []byte) error {
	// #nosec G304 -- callers supply repository-owned generated asset paths.
	current, err := os.ReadFile(path)
	if err == nil && bytes.Equal(current, data) {
		return nil
	}
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	// #nosec G301 -- generated repository assets need normal directory traversal.
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	// #nosec G306,G703 -- callers supply checked-in asset paths which must be world-readable.
	return os.WriteFile(path, data, 0o644)
}

var iconComposerJSON = func() string {
	value := map[string]any{
		"fill": map[string]any{"solid": "srgb:0.05098,0.06667,0.09020,1.00000"},
		"groups": []any{map[string]any{
			"layers": []any{map[string]any{
				"image-name": "mill-mark.svg",
				"name":       "mill-mark",
				"position": map[string]any{
					"scale":                 0.72,
					"translation-in-points": []float64{0, 0},
				},
			}},
			"shadow":       map[string]any{"kind": "neutral", "opacity": 0.5},
			"specular":     true,
			"translucency": map[string]any{"enabled": true, "value": 0.5},
		}},
		"supported-platforms": map[string]any{
			"circles": []string{"watchOS"},
			"squares": "shared",
		},
	}
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		panic(err)
	}
	return string(data) + "\n"
}()
