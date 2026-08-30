package atlassvc

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/alicoding/mill/internal/domain/atlas"
)

// WriteObjectMirror overwrites objectID's own mirrored file with
// content -- the embedded editor engine's save/autosave path (goal
// 0237 S1) and the sheet quick-edit's csv commit (goal 0239 S2), both
// whole-file text writes. The file is the SAME mirror armMirrorWatch
// already watches, so this deliberately does not emit
// MirrorChangedEvent itself: the write lands on disk, the existing
// fsnotify watch (goal 0194) picks it up on its own debounce, and the
// board preview refreshes through that one path -- never a second,
// race-prone signal alongside the watch's own.
func (a *AtlasService) WriteObjectMirror(objectID, content string) error {
	a.mu.RLock()
	idx := a.findObjectLocked(objectID)
	if idx == -1 {
		a.mu.RUnlock()
		return fmt.Errorf("no board object with id %q", objectID)
	}
	path := a.objects[idx].Payload["mirrorPath"]
	a.mu.RUnlock()
	if path == "" {
		return fmt.Errorf("board object %q has no mirrored file", objectID)
	}
	ext := strings.ToLower(filepath.Ext(path))
	if !atlas.IsDiagramMirrorExtension(ext) {
		return fmt.Errorf("write object mirror: %q is not a recognized diagram extension", path)
	}
	// The shared family gate above also admits binary spreadsheet
	// extensions, but no caller can legitimately write frontend TEXT
	// over a binary workbook -- that write is corruption by
	// construction (goal 0239 S2's own data-stewardship refusal), so
	// it fails closed here rather than trusting every future caller.
	if atlas.ClassifyMirrorKind(path) == atlas.MirrorKindSheet {
		return fmt.Errorf("write object mirror: %q is a binary spreadsheet -- edit it in its own app", path)
	}
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		return fmt.Errorf("write object mirror: %w", err)
	}
	return nil
}
