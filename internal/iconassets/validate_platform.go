package main

import (
	"context"
	"encoding/json"
	"fmt"
	"image"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

type assetCatalogEntry struct {
	AssetType    string              `json:"AssetType"`
	CanvasHeight float64             `json:"CanvasHeight"`
	CanvasWidth  float64             `json:"CanvasWidth"`
	Name         string              `json:"Name"`
	Layers       []assetCatalogLayer `json:"Layers"`
}

type assetCatalogLayer struct {
	LayerPosition string `json:"LayerPosition"`
	LayerSize     string `json:"LayerSize"`
	Name          string `json:"Name"`
}

func validatePackaged(root string) error {
	if err := validatePlatformSignatures(root); err != nil {
		return err
	}
	return validateAssetCatalog(root)
}

func validatePlatformSignatures(root string) error {
	for path, magic := range map[string]string{
		"build/darwin/icons.icns": "icns",
		"build/windows/icon.ico":  "\x00\x00\x01\x00",
	} {
		// #nosec G304 -- paths are fixed repository-owned package outputs.
		data, err := os.ReadFile(filepath.Join(root, path))
		if err != nil {
			return err
		}
		if len(data) < len(magic) || string(data[:len(magic)]) != magic {
			return fmt.Errorf("%s has invalid format signature", path)
		}
	}
	return nil
}

func validateAssetCatalog(root string) error {
	assetCatalog := filepath.Join(root, "build/darwin/Assets.car")
	if _, err := os.Stat(assetCatalog); err != nil {
		return nil
	}
	assetutil, err := exec.LookPath("assetutil")
	if err != nil {
		assetutil = "/usr/bin/assetutil"
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	// #nosec G204 -- executable and argument are fixed local packaging tools and output.
	out, err := exec.CommandContext(ctx, assetutil, "--info", assetCatalog).Output()
	if err != nil {
		return fmt.Errorf("inspect Assets.car: %w", err)
	}
	return validateAssetCatalogMetadata(out)
}

func validateAssetCatalogMetadata(data []byte) error {
	var metadata []assetCatalogEntry
	if err := json.Unmarshal(data, &metadata); err != nil {
		return fmt.Errorf("parse Assets.car metadata: %w", err)
	}
	if err := validateAssetCatalogIdentity(data); err != nil {
		return err
	}
	canvasWidth, canvasHeight, err := assetCatalogCanvas(metadata)
	if err != nil {
		return err
	}
	return validateAssetCatalogLayers(metadata, canvasWidth, canvasHeight)
}

func validateAssetCatalogIdentity(data []byte) error {
	var untyped any
	if err := json.Unmarshal(data, &untyped); err != nil {
		return fmt.Errorf("parse Assets.car metadata: %w", err)
	}
	joined := strings.ToLower(strings.Join(collectStrings(untyped), "\n"))
	if !strings.Contains(joined, "mill-mark") || strings.Contains(joined, "wails") {
		return fmt.Errorf("assets.car does not contain only the Mill foreground identity")
	}
	return nil
}

func assetCatalogCanvas(metadata []assetCatalogEntry) (float64, float64, error) {
	canvasWidth, canvasHeight := 0.0, 0.0
	for _, entry := range metadata {
		if entry.AssetType != "IconImageStack" || entry.Name != "appicon" {
			continue
		}
		if entry.CanvasWidth <= 0 || entry.CanvasHeight <= 0 {
			return 0, 0, fmt.Errorf("assets.car appicon has invalid canvas %.3fx%.3f", entry.CanvasWidth, entry.CanvasHeight)
		}
		if canvasWidth == 0 {
			canvasWidth, canvasHeight = entry.CanvasWidth, entry.CanvasHeight
		}
		if entry.CanvasWidth != canvasWidth || entry.CanvasHeight != canvasHeight {
			return 0, 0, fmt.Errorf("assets.car appicon appearances use inconsistent canvas sizes")
		}
	}
	if canvasWidth == 0 {
		return 0, 0, fmt.Errorf("assets.car has no appicon canvas metadata")
	}
	return canvasWidth, canvasHeight, nil
}

func validateAssetCatalogLayers(metadata []assetCatalogEntry, canvasWidth, canvasHeight float64) error {
	validatedLayers := 0
	for _, entry := range metadata {
		if entry.AssetType != "IconGroup" || entry.Name != "appicon/Group" {
			continue
		}
		for _, layer := range entry.Layers {
			if !strings.HasSuffix(layer.Name, "/mill-mark") {
				continue
			}
			if err := validateAssetCatalogLayer(layer, canvasWidth, canvasHeight); err != nil {
				return err
			}
			validatedLayers++
		}
	}
	if validatedLayers == 0 {
		return fmt.Errorf("assets.car has no compiled Mill foreground layer geometry")
	}
	return nil
}

func validateAssetCatalogLayer(layer assetCatalogLayer, canvasWidth, canvasHeight float64) error {
	width, height, err := parseCatalogPair(layer.LayerSize)
	if err != nil {
		return fmt.Errorf("parse Mill foreground layer size: %w", err)
	}
	x, y, err := parseCatalogPair(layer.LayerPosition)
	if err != nil {
		return fmt.Errorf("parse Mill foreground layer position: %w", err)
	}
	// Apple may round compiled point geometry; allow at most one canvas point.
	tolerance := 1.0 / math.Min(canvasWidth, canvasHeight)
	if math.Abs(width/canvasWidth-iconComposerMarkProportion) > tolerance ||
		math.Abs(height/canvasHeight-iconComposerMarkProportion) > tolerance {
		return fmt.Errorf("assets.car Mill foreground layer %.3fx%.3f is not %.0f%% of %.3fx%.3f canvas", width, height, iconComposerMarkProportion*100, canvasWidth, canvasHeight)
	}
	if math.Abs((x+width/2)-canvasWidth/2) > 1 || math.Abs((y+height/2)-canvasHeight/2) > 1 {
		return fmt.Errorf("assets.car Mill foreground layer is not centered: position %.3f,%.3f size %.3fx%.3f canvas %.3fx%.3f", x, y, width, height, canvasWidth, canvasHeight)
	}
	return nil
}

func parseCatalogPair(value string) (float64, float64, error) {
	first, second, ok := strings.Cut(value, ",")
	if !ok {
		return 0, 0, fmt.Errorf("expected comma-separated pair, got %q", value)
	}
	x, err := strconv.ParseFloat(strings.TrimSpace(first), 64)
	if err != nil {
		return 0, 0, fmt.Errorf("parse %q: %w", first, err)
	}
	y, err := strconv.ParseFloat(strings.TrimSpace(second), 64)
	if err != nil {
		return 0, 0, fmt.Errorf("parse %q: %w", second, err)
	}
	return x, y, nil
}

func validateIOSGenerator(root string) error {
	iosIcon := filepath.Join(root, "build/ios/xcode/main/Assets.xcassets/AppIcon.appiconset/icon-1024.png")
	img, err := validatePNG(iosIcon, pngContract{size: 1024, fullBleed: true, appPalette: true})
	if err != nil {
		return err
	}
	source, err := validatePNG(filepath.Join(root, "build/ios/icon.png"), pngContract{size: 1024, fullBleed: true, appPalette: true})
	if err != nil {
		return err
	}
	if !imagesEqual(img, source) {
		return fmt.Errorf("iOS generator output does not preserve build/ios/icon.png pixels")
	}
	return nil
}

func collectStrings(value any) []string {
	var result []string
	var walk func(any)
	walk = func(current any) {
		switch typed := current.(type) {
		case string:
			result = append(result, typed)
		case []any:
			for _, item := range typed {
				walk(item)
			}
		case map[string]any:
			for key, item := range typed {
				result = append(result, key)
				walk(item)
			}
		}
	}
	walk(value)
	return result
}

func imagesEqual(a, b image.Image) bool {
	if a.Bounds() != b.Bounds() {
		return false
	}
	for y := a.Bounds().Min.Y; y < a.Bounds().Max.Y; y++ {
		for x := a.Bounds().Min.X; x < a.Bounds().Max.X; x++ {
			ar, ag, ab, aa := a.At(x, y).RGBA()
			br, bg, bb, ba := b.At(x, y).RGBA()
			if ar != br || ag != bg || ab != bb || aa != ba {
				return false
			}
		}
	}
	return true
}
