package atlassvc

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/alicoding/mill/internal/domain/atlas"
)

// WriteObjectMirror overwrites objectID's own mirrored diagram file with
// xml -- the embedded editor engine's own save/autosave path (goal 0237
// S1: the engine's postMessage protocol is the only caller). The file is
// the SAME mirror armMirrorWatch already watches, so this deliberately
// does not emit MirrorChangedEvent itself: the write lands on disk, the
// existing fsnotify watch (goal 0194) picks it up on its own debounce,
// and the board preview refreshes through that one path -- never a
// second, race-prone signal alongside the watch's own.
func (a *AtlasService) WriteObjectMirror(objectID, xml string) error {
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
	if !atlas.IsDiagramMirrorExtension(strings.ToLower(filepath.Ext(path))) {
		return fmt.Errorf("write object mirror: %q is not a recognized diagram extension", path)
	}
	if err := os.WriteFile(path, []byte(xml), 0o600); err != nil {
		return fmt.Errorf("write object mirror: %w", err)
	}
	return nil
}
