package atlassvc

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/alicoding/mill/internal/services/seeding"
)

// SaveMirrorText is SaveImageBytes' text counterpart (goal 0323): a
// caller that has a file-backed board object's CONTENT but no file for
// it yet -- an agent authoring a diagram over MCP -- lands the bytes
// here first, then passes the returned path to CreateBoardObject as
// the object's own mirrorPath. Board-object creation stays a
// deliberately separate step for the same reason it does there: the
// object arrives through the one already-journaled create door, never
// a second one.
//
// ext must be one of the text-backed mirror extensions below,
// including its leading "." -- checked before anything reaches the
// filesystem, so an unrecognized (or binary) format can never be
// written as text.
var textMirrorExtensions = map[string]bool{
	".drawio": true, ".mmd": true, ".mermaid": true, ".csv": true, ".svg": true,
}

func (a *AtlasService) SaveMirrorText(content, ext, title string) (string, error) {
	ext = strings.ToLower(ext)
	if !textMirrorExtensions[ext] {
		return "", fmt.Errorf("atlas mirror create: %q is not a text-backed mirror extension", ext)
	}
	if strings.TrimSpace(content) == "" {
		return "", fmt.Errorf("atlas mirror create: the file content is empty")
	}

	a.mu.RLock()
	dir := a.capturesDir
	a.mu.RUnlock()
	if dir == "" {
		return "", fmt.Errorf("atlas mirror create: no captures directory configured")
	}
	// 0o750, not 0o755 -- this repo's gosec gate (G301) caps created-
	// directory permissions, matching SaveImageBytes' own creation.
	if err := os.MkdirAll(dir, 0o750); err != nil {
		return "", fmt.Errorf("atlas mirror create: %w", err)
	}

	path := filepath.Join(dir, seeding.NewSlugID(title, "mirror")+ext)
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil { //nolint:gosec // ext is checked against the fixed allow-list above, and the filename is a minted seeding.NewSlugID, never the raw title
		return "", fmt.Errorf("atlas mirror create: write: %w", err)
	}
	return path, nil
}
