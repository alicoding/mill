package atlassvc

import (
	"encoding/base64"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/alicoding/mill/internal/adapters/fileread"
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
// about it). Re-runs reconcileBuiltIns after wiring (goal 0223): the
// construction-time reconcile pass runs before this is ever called, so
// a file-backed seeded board object (ink/image/diagram,
// builtInBoardObjectsLocked) has no captures directory to materialize
// its mirror file into yet -- this is the first point one exists, and
// reconcile's own top-up semantics make a second, mid-lifetime pass
// safe (a no-op for every already-seeded family).
//
//wails:ignore
func (a *AtlasService) SetCapturesDir(dir string) {
	a.mu.Lock()
	a.capturesDir = dir
	a.mu.Unlock()
	a.reconcileBuiltIns()
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

// testImagePickPathEnv mirrors testFolderPickPathEnv's own e2e bypass
// (atlasservice_folderscan.go): server-mode Playwright has no display a
// real NSOpenPanel could render into, so every spawned e2e server sets
// this to a fixture image path. Unset in every real deployment, where
// PickImageFile always opens the actual OS dialog.
const testImagePickPathEnv = "MILL_TEST_IMAGE_PICK_PATH"

// PickImageFile opens the native image-file picker (goal 0206: a typed
// path string is developer vocabulary, not a user-facing affordance) --
// filtered to recognized image extensions. Returns "" (no error) when
// the user cancels.
func (a *AtlasService) PickImageFile() (string, error) {
	if testPath := os.Getenv(testImagePickPathEnv); testPath != "" {
		return testPath, nil
	}
	return windowing.PickImageFile("Choose an image")
}

// MirrorImageFromPath copies srcPath's own bytes into a fresh file under
// the captures directory, returning the new file's path -- the
// data-safety half of a native image drop (goal 0206): the OS may hand
// a drop event a temp/promise path under /var/folders (a drag from a
// screenshot thumbnail or another app materializes a file promise
// there) that it reclaims once the drag completes, so a drop-created
// object's own MirrorPath must point at a copy Mill owns, never the
// ephemeral original. Reuses SaveImageBytes's own writer/validation
// rather than a second copy of either. Bounded by fileread.MaxBytes.
func (a *AtlasService) MirrorImageFromPath(srcPath, title string) (string, error) {
	ext := strings.ToLower(filepath.Ext(srcPath))
	if !atlas.IsImageExtension(ext) {
		return "", fmt.Errorf("atlas image mirror: %q is not a recognized image extension", srcPath)
	}
	raw, err := fileread.Read(srcPath)
	if err != nil {
		return "", fmt.Errorf("atlas image mirror: %w", err)
	}
	return a.SaveImageBytes(base64.StdEncoding.EncodeToString([]byte(raw)), ext, title)
}
