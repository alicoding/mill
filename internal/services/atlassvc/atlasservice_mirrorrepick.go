package atlassvc

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/alicoding/mill/internal/adapters/windowing"
	"github.com/alicoding/mill/internal/domain/atlas"
	"github.com/alicoding/mill/internal/services/dataevent"
)

// testDiagramPickPathEnv mirrors testImagePickPathEnv's own e2e bypass
// (atlasservice_imagecapture.go): server-mode Playwright has no display
// a real NSOpenPanel could render into, so every spawned e2e server
// that needs one sets this to a fixture diagram path. Unset in every
// real deployment, where PickDiagramFile always opens the actual OS
// dialog.
const testDiagramPickPathEnv = "MILL_TEST_DIAGRAM_PICK_PATH"

// PickDiagramFile opens the native diagram-file picker -- the honest-
// state "Choose file" action's own path resolution step (goal 0194: a
// typed path string is developer vocabulary, not a user-facing
// affordance, same rule PickImageFile already follows). Returns "" (no
// error) when the user cancels.
func (a *AtlasService) PickDiagramFile() (string, error) {
	if testPath := os.Getenv(testDiagramPickPathEnv); testPath != "" {
		return testPath, nil
	}
	return windowing.PickDiagramFile("Choose a diagram file")
}

// RepickCardMirror points cardID's own MirrorPath at a newly chosen
// file -- the honest-state "Choose file" action's own apply step, used
// both after a vanished-file re-pick and to swap a diagram for a
// different one outright. Re-arms the live filewatch binding and fires
// MirrorChangedEvent immediately, so the page that just showed "file
// not found" refetches without waiting on the next external edit.
func (a *AtlasService) RepickCardMirror(cardID, path string) (atlas.Card, error) {
	ext := strings.ToLower(filepath.Ext(path))
	if !atlas.IsDiagramMirrorExtension(ext) {
		return atlas.Card{}, fmt.Errorf("repick card mirror: %q is not a recognized diagram extension", path)
	}
	a.mu.Lock()
	idx := a.findCardLocked(cardID)
	if idx == -1 {
		a.mu.Unlock()
		return atlas.Card{}, fmt.Errorf("no card with id %q", cardID)
	}
	previous := a.cards[idx]
	a.cards[idx].MirrorPath = path
	a.cards[idx].MirrorMissing = false
	a.cards[idx].UpdatedAt = time.Now()
	perr := a.persistLocked()
	if perr != nil {
		a.cards[idx] = previous
	}
	c := a.cards[idx]
	a.mu.Unlock()
	if perr != nil {
		return atlas.Card{}, fmt.Errorf("save card mirror re-pick: %w", perr)
	}
	dataevent.Emit("atlas", cardID)
	a.armMirrorWatch(cardID, path)
	emitMirrorChanged(cardID)
	return c, nil
}

// RepickObjectMirror is RepickCardMirror's own counterpart for a board
// object's Payload["mirrorPath"] entry.
func (a *AtlasService) RepickObjectMirror(objectID, path string) (atlas.BoardObject, error) {
	ext := strings.ToLower(filepath.Ext(path))
	if !atlas.IsDiagramMirrorExtension(ext) {
		return atlas.BoardObject{}, fmt.Errorf("repick object mirror: %q is not a recognized diagram extension", path)
	}
	a.mu.Lock()
	idx := a.findObjectLocked(objectID)
	if idx == -1 {
		a.mu.Unlock()
		return atlas.BoardObject{}, fmt.Errorf("no board object with id %q", objectID)
	}
	previous := a.objects[idx]
	updated := copyPayload(a.objects[idx].Payload)
	updated["mirrorPath"] = path
	a.objects[idx].Payload = updated
	a.objects[idx].UpdatedAt = time.Now()
	perr := a.persistLocked()
	if perr != nil {
		a.objects[idx] = previous
	}
	o := a.objects[idx]
	a.mu.Unlock()
	if perr != nil {
		return atlas.BoardObject{}, fmt.Errorf("save board object mirror re-pick: %w", perr)
	}
	dataevent.Emit("atlas", objectID)
	a.armMirrorWatch(objectID, path)
	emitMirrorChanged(objectID)
	return o, nil
}
