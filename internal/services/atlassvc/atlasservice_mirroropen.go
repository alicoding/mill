package atlassvc

import (
	"fmt"
	"os"

	"github.com/alicoding/mill/internal/adapters/osopen"
	"github.com/alicoding/mill/internal/adapters/windowing"
)

// objectMirrorPathLocked resolves id's own Payload["mirrorPath"], or an
// error naming which of "unknown object"/"nothing mirrored" applies --
// the board-object twin of atlasservice_share.go's own
// cardMirrorPathLocked, kept separate rather than shared because a
// BoardObject's path lives in Payload while a Card's is its own struct
// field.
func (a *AtlasService) objectMirrorPathLocked(id string) (string, error) {
	idx := a.findObjectLocked(id)
	if idx == -1 {
		return "", fmt.Errorf("no board object with id %q", id)
	}
	path := a.objects[idx].Payload["mirrorPath"]
	if path == "" {
		return "", fmt.Errorf("board object %q has no mirrored file", id)
	}
	return path, nil
}

// OpenObjectMirrorInDefaultApp launches a file-backed board object's
// own mirrored file with the OS default application for its file type
// (goal 0232 S1's "open in owning app" contract, the registry command
// object.openInDefaultApp) -- the same OS door OpenCardMirror already
// uses (internal/adapters/osopen, goal 0081 slice A4's own research:
// Wails3's BrowserManager.OpenFile covers "launch a path", but this
// package's Reveal has no Wails equivalent, so both verbs share one
// tested adapter rather than splitting across two).
//
// Unlike OpenCardMirror, this validates the path still exists on disk
// FIRST: a board object's mirror is more likely to go stale (goal
// 0194's own live-watch/re-pick machinery exists because these files
// move/vanish more often than a card's), and asking the OS to launch a
// path that no longer resolves would surface nothing back to Mill's
// own error UI at all -- osopen.Open only reports a failure to START
// the OS opener, never the opener's own async "no such file" result.
func (a *AtlasService) OpenObjectMirrorInDefaultApp(id string) error {
	a.mu.RLock()
	path, err := a.objectMirrorPathLocked(id)
	a.mu.RUnlock()
	if err != nil {
		return err
	}
	if _, statErr := os.Stat(path); statErr != nil {
		return fmt.Errorf("mirrored file no longer exists: %w", statErr)
	}
	if !windowing.Available() {
		return nil
	}
	return osopen.Open(path)
}
