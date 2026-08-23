package atlassvc

import (
	"encoding/base64"
	"fmt"
	"os"
	"path/filepath"

	"github.com/alicoding/mill/internal/adapters/windowing"
	"github.com/alicoding/mill/internal/domain/atlas"
	"github.com/alicoding/mill/internal/services/seeding"
)

// The image tool's paste door (goal 0169 slice 2, the paste-or-drop
// interaction's own new surface): unlike a native OS file drop or a
// typed local path -- both of which already name a REAL file on disk,
// landing straight through CreateCardFromFileDrop's existing mirror-
// only reference -- a clipboard image is raw bytes with no path at
// all. This file is the one new door that turns those bytes into a
// real file, after which the card itself is created through the exact
// same CreateCardFromFileDrop the native drop door already uses.

// DefaultCapturesDir resolves the atlas-captures root directory: override
// if non-empty (main.go's own MILL_ATLAS_CAPTURES_DIR read via
// wiring.WireAtlasStorageDirs), otherwise the same mill/<subdir> OS
// config-home convention DefaultMirrorsDir already uses. A plain
// function, not a method -- same shape DefaultMirrorsDir takes for its
// own pre-construction path resolution.
func DefaultCapturesDir(override string) string {
	if override != "" {
		return override
	}
	return filepath.Join(windowing.ConfigHome(), "mill", "atlas-captures")
}

// SetCapturesDir wires the captures directory in from main.go, mirroring
// SetMirrorsDir's own constructor-parameter avoidance (AtlasService
// already has many callers, tests included, that have no reason to know
// about it).
//
//wails:ignore
func (a *AtlasService) SetCapturesDir(dir string) {
	a.mu.Lock()
	a.capturesDir = dir
	a.mu.Unlock()
}

// SaveImageBytes decodes base64Data (standard encoding) and writes it to
// a fresh file under the captures directory, returning the file's own
// path. ext must be one of atlas.IsImageExtension's recognized image
// extensions (including its leading "."), checked here so a bad paste
// never reaches the filesystem. Card creation is a deliberately separate
// step -- the caller passes the returned path straight to
// CreateCardFromFileDrop, so a pasted image and a natively dropped one
// resolve their Kind, duplicate check, and card fields through the
// exact same logic.
func (a *AtlasService) SaveImageBytes(base64Data, ext, title string) (string, error) {
	if !atlas.IsImageExtension(ext) {
		return "", fmt.Errorf("atlas image capture: %q is not a recognized image extension", ext)
	}
	data, err := base64.StdEncoding.DecodeString(base64Data)
	if err != nil {
		return "", fmt.Errorf("atlas image capture: decode: %w", err)
	}

	a.mu.RLock()
	dir := a.capturesDir
	a.mu.RUnlock()
	if dir == "" {
		return "", fmt.Errorf("atlas image capture: no captures directory configured")
	}
	// 0o750, not 0o755 -- this repo's gosec gate (G301) caps created-
	// directory permissions, matching atlasservice_share.go's own
	// spaceFolderPathLocked.
	if err := os.MkdirAll(dir, 0o750); err != nil {
		return "", fmt.Errorf("atlas image capture: %w", err)
	}

	path := filepath.Join(dir, seeding.NewSlugID(title, "image")+ext)
	if err := os.WriteFile(path, data, 0o600); err != nil {
		return "", fmt.Errorf("atlas image capture: write: %w", err)
	}
	return path, nil
}
