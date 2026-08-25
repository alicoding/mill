package atlassvc

import (
	"log/slog"
	"path/filepath"
	"strings"
	"time"

	"github.com/alicoding/mill/internal/adapters/filewatch"
	"github.com/alicoding/mill/internal/adapters/windowing"
	"github.com/alicoding/mill/internal/domain/atlas"
)

// mirrorDebounce coalesces a burst of writes from one external editor
// save (or a CLI tool rewriting the file in several syscalls) into a
// single refetch signal -- goal 0194's live round-trip slice.
const mirrorDebounce = 500 * time.Millisecond

// MirrorChangedEvent is registered by main.go (application.RegisterEvent)
// and listened for in the frontend's diagram/mermaid hosts -- exported
// so main.go's registration and every emit site spell the same wire
// name, same convention dataevent.EventName already establishes.
const MirrorChangedEvent = "atlas-mirror-changed"

// MirrorChanged is MirrorChangedEvent's payload: which card or board
// object's own mirrored file just changed on disk. ID is deliberately
// untyped as to card-vs-object -- a frontend host already knows which
// kind of entity it's rendering, so it only needs to compare its own
// id.
type MirrorChanged struct {
	ID string `json:"id"`
}

// MirrorWatchTestHook, when non-nil, is invoked with the id every time
// a debounced file-change actually fires -- windowing.Emit is a no-op
// under `go test` (no live Wails application), so this is the
// observable seam a test uses instead, same shape dataevent.TestHook
// already establishes for the general live-sync event. Package-level;
// a test that sets it must restore it to nil via t.Cleanup.
var MirrorWatchTestHook func(id string)

// armMirrorWatch (re-)arms a live filewatch binding on id's own
// mirrored file -- a no-op for any path whose extension isn't a live-
// rendered diagram source (atlas.IsDiagramMirrorExtension), so calling
// this unconditionally after every card/object creation costs nothing
// for the common non-diagram case. Replaces any existing binding for
// id first, so a re-pick (new path, same id) never leaves the old
// binding watching a stale file alongside the new one.
func (a *AtlasService) armMirrorWatch(id, path string) {
	if path == "" || !atlas.IsDiagramMirrorExtension(strings.ToLower(filepath.Ext(path))) {
		return
	}
	dir := filepath.Dir(path)
	base := filepath.Base(path)
	binding, err := filewatch.Watch(dir, base, func(string) {
		a.debounceMirrorEmit(id)
	})
	if err != nil {
		// The containing directory may not exist yet, or may have gone
		// away -- a live watch is a nice-to-have on top of MirrorContent's
		// own always-fresh-per-RPC read, never a hard requirement, so this
		// logs rather than propagating to the create call it rides on.
		slog.Warn("atlas mirror watch: failed to arm", "id", id, "path", path, "error", err)
		return
	}
	a.watchMu.Lock()
	if old, ok := a.mirrorWatches[id]; ok {
		_ = old.Close()
	}
	a.mirrorWatches[id] = binding
	a.watchMu.Unlock()
}

// disarmMirrorWatch closes and forgets id's own binding (if any) --
// called on delete and on service shutdown. A no-op for an id that was
// never armed (nothing to watch, or a non-diagram mirror).
func (a *AtlasService) disarmMirrorWatch(id string) {
	a.watchMu.Lock()
	defer a.watchMu.Unlock()
	if b, ok := a.mirrorWatches[id]; ok {
		_ = b.Close()
		delete(a.mirrorWatches, id)
	}
	if t, ok := a.mirrorDebouncers[id]; ok {
		t.Stop()
		delete(a.mirrorDebouncers, id)
	}
}

// debounceMirrorEmit resets id's own pending timer (coalescing a
// burst) or starts one -- fires MirrorChangedEvent once the timer
// finally elapses with no further write in between. Guarded by
// mirrorWatches still holding id: fsnotify's own delivery goroutine
// isn't synchronized with Close (a buffered event already in flight
// can still reach here immediately after disarmMirrorWatch/
// CloseAllMirrorWatches ran), so an id no longer armed is a no-op
// rather than scheduling an orphan timer nothing will ever stop.
func (a *AtlasService) debounceMirrorEmit(id string) {
	a.watchMu.Lock()
	defer a.watchMu.Unlock()
	if _, stillArmed := a.mirrorWatches[id]; !stillArmed {
		return
	}
	if t, ok := a.mirrorDebouncers[id]; ok {
		t.Reset(mirrorDebounce)
		return
	}
	a.mirrorDebouncers[id] = time.AfterFunc(mirrorDebounce, func() {
		a.watchMu.Lock()
		delete(a.mirrorDebouncers, id)
		_, stillArmed := a.mirrorWatches[id]
		a.watchMu.Unlock()
		if stillArmed {
			emitMirrorChanged(id)
		}
	})
}

// emitMirrorChanged fires MirrorChangedEvent for id -- the debounced
// external-edit path above and RepickCardMirror/RepickObjectMirror's
// own immediate "the mirror just moved" signal both funnel through
// here, so a test only ever has to watch one seam.
func emitMirrorChanged(id string) {
	windowing.Emit(MirrorChangedEvent, MirrorChanged{ID: id})
	if MirrorWatchTestHook != nil {
		MirrorWatchTestHook(id)
	}
}

// armExistingMirrorWatches arms every LIVE card/object's own diagram
// mirror at startup -- NewAtlasService's own counterpart to the
// per-create arm call, so a diagram authored in a previous run is
// watched again from the moment this run's service exists, not only
// from its next edit.
func (a *AtlasService) armExistingMirrorWatches() {
	a.mu.RLock()
	type target struct{ id, path string }
	var targets []target
	for _, c := range a.cards {
		if c.DeletedAt.IsZero() && c.MirrorPath != "" {
			targets = append(targets, target{c.ID, c.MirrorPath})
		}
	}
	for _, o := range a.objects {
		if o.DeletedAt.IsZero() {
			if path := o.Payload["mirrorPath"]; path != "" {
				targets = append(targets, target{o.ID, path})
			}
		}
	}
	a.mu.RUnlock()
	for _, tgt := range targets {
		a.armMirrorWatch(tgt.id, tgt.path)
	}
}

// CloseAllMirrorWatches closes every live filewatch binding -- called
// once from main.go's shutdown sequence so no watcher goroutine
// outlives the process. Not a frontend RPC: shutdown is main.go's own
// concern.
//
//wails:ignore
func (a *AtlasService) CloseAllMirrorWatches() {
	a.watchMu.Lock()
	defer a.watchMu.Unlock()
	for _, b := range a.mirrorWatches {
		_ = b.Close()
	}
	a.mirrorWatches = map[string]*filewatch.Binding{}
	for _, t := range a.mirrorDebouncers {
		t.Stop()
	}
	a.mirrorDebouncers = map[string]*time.Timer{}
}
