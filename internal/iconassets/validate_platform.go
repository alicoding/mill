package main

import (
	"context"
	"encoding/json"
	"fmt"
	"image"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

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
	var metadata any
	if err := json.Unmarshal(out, &metadata); err != nil {
		return fmt.Errorf("parse Assets.car metadata: %w", err)
	}
	joined := strings.ToLower(strings.Join(collectStrings(metadata), "\n"))
	if !strings.Contains(joined, "mill-mark") || strings.Contains(joined, "wails") {
		return fmt.Errorf("assets.car does not contain only the Mill foreground identity")
	}
	return nil
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
