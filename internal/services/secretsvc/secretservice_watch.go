package secretsvc

import (
	"path/filepath"
	"time"

	"github.com/alicoding/mill/internal/adapters/filewatch"
	"github.com/alicoding/mill/internal/adapters/windowing"
	"github.com/alicoding/mill/internal/domain/secretsource"
)

// Sources are watched (goal 0408 S1, ADR-0050): a dotenv/Bruno
// source's key list and problems come from the file as it is NOW at
// every resolve already (secretservice_providers.go); what live
// watching adds is telling every open picker/Sources row to refetch
// the moment an external editor changes the file, instead of only on
// the next expand -- direnv's own converged file-watch-then-reload
// model (the goal's own Precedent). The watch never caches a value:
// only the LIST and problems refresh, the same posture the resolve
// path already holds. filewatch.Watch's own dir+base-name-match shape
// (atlasservice_mirrorwatch.go's established use of it) already covers
// an atomic-rename writer: the watch is on the PARENT directory, not
// an inode, so a rewritten file under the same name still fires.

// sourcesChangedDebounce coalesces a burst of writes from one external
// save into one refetch signal -- same shape and reasoning as
// atlassvc's own mirrorDebounce, a shorter window since a source's own
// key list is cheap to recompute.
const sourcesChangedDebounce = 250 * time.Millisecond

// SourcesChangedEvent is registered by main.go (application.
// RegisterEvent) -- exported so main.go's registration and this file's
// own emit site spell the same wire name, same convention
// atlassvc.MirrorChangedEvent already establishes.
const SourcesChangedEvent = "secrets:sources-changed"

// SourcesChanged is SourcesChangedEvent's payload: which source's file
// just changed on disk.
type SourcesChanged struct {
	SourceID string `json:"sourceId"`
}

// SourcesChangedTestHook, when non-nil, is invoked with the source id
// every time a debounced file-change actually fires -- windowing.Emit
// is a no-op under `go test` (no live Wails application), so this is
// the observable seam a test uses instead, the same shape
// atlassvc.MirrorWatchTestHook already establishes. Package-level; a
// test that sets it must restore it to nil via t.Cleanup.
var SourcesChangedTestHook func(sourceID string)

// RearmSourceWatches (re)computes the watch set from the current
// source list: closes a watch whose source no longer exists or is no
// longer file-backed, and (re)arms one for every dotenv/Bruno source --
// always replacing an existing binding, so an edited path watches the
// new file rather than the old one. Called once after SetSourcesLister
// wires the source list (wiring.WireSecrets), and again after every
// Configure-side secret-source create/update/delete
// (configuresvc.SetSecretSourcesChanged). A source whose directory
// can't be watched (a missing path, no permission) is simply left
// unwatched -- SourceProblems already reports why the source itself
// lists nothing; a live watch is a nice-to-have on top of that resolve-
// time read, never a hard requirement. Exported for wiring only, never
// a frontend RPC.
//
//wails:ignore
func (s *SecretService) RearmSourceWatches() {
	want := map[string]secretsource.Source{}
	for _, src := range s.sourcesSnapshot() {
		if src.Kind == secretsource.KindEnv || src.Kind == secretsource.KindBruno {
			want[src.ID] = src
		}
	}
	s.watchMu.Lock()
	defer s.watchMu.Unlock()
	if s.sourceWatches == nil {
		s.sourceWatches = map[string]*filewatch.Binding{}
	}
	for id, b := range s.sourceWatches {
		if _, ok := want[id]; !ok {
			_ = b.Close()
			delete(s.sourceWatches, id)
			s.stopSourceDebounceLocked(id)
		}
	}
	for id, src := range want {
		if old, ok := s.sourceWatches[id]; ok {
			_ = old.Close()
			delete(s.sourceWatches, id)
		}
		path := envPathOf(src)
		dir, base := filepath.Dir(path), filepath.Base(path)
		binding, err := filewatch.Watch(dir, base, func(string) { s.debounceSourceChange(id) })
		if err != nil {
			continue
		}
		s.sourceWatches[id] = binding
	}
}

// debounceSourceChange resets id's own pending timer (coalescing a
// burst of writes from one save) or starts one -- fires
// SourcesChangedEvent once the timer elapses with no further write in
// between. Guarded by sourceWatches still holding id: fsnotify's own
// delivery goroutine isn't synchronized with Close (a buffered event
// already in flight can still reach here immediately after
// RearmSourceWatches dropped the source), the same race
// atlassvc.debounceMirrorEmit's own comment names.
func (s *SecretService) debounceSourceChange(id string) {
	s.watchMu.Lock()
	defer s.watchMu.Unlock()
	if _, stillArmed := s.sourceWatches[id]; !stillArmed {
		return
	}
	if s.sourceDebouncers == nil {
		s.sourceDebouncers = map[string]*time.Timer{}
	}
	if t, ok := s.sourceDebouncers[id]; ok {
		t.Reset(sourcesChangedDebounce)
		return
	}
	s.sourceDebouncers[id] = time.AfterFunc(sourcesChangedDebounce, func() {
		s.watchMu.Lock()
		delete(s.sourceDebouncers, id)
		_, stillArmed := s.sourceWatches[id]
		s.watchMu.Unlock()
		if stillArmed {
			s.emitSourcesChanged(id)
		}
	})
}

// SetSourceChangeHook wires process-local consumers that must invalidate
// derived evidence when an enabled source file changes. Keeping this as a
// package function prevents Wails from exposing the callback seam as an RPC.
func SetSourceChangeHook(s *SecretService, fn func(string)) {
	s.watchMu.Lock()
	s.sourceChangeHook = fn
	s.watchMu.Unlock()
}

// stopSourceDebounceLocked cancels id's own pending timer, if any --
// caller must hold watchMu.
func (s *SecretService) stopSourceDebounceLocked(id string) {
	if t, ok := s.sourceDebouncers[id]; ok {
		t.Stop()
		delete(s.sourceDebouncers, id)
	}
}

// emitSourcesChanged fires SourcesChangedEvent for id.
func (s *SecretService) emitSourcesChanged(id string) {
	windowing.Emit(SourcesChangedEvent, SourcesChanged{SourceID: id})
	s.watchMu.Lock()
	hook := s.sourceChangeHook
	s.watchMu.Unlock()
	if hook != nil {
		hook(id)
	}
	if SourcesChangedTestHook != nil {
		SourcesChangedTestHook(id)
	}
}

// CloseAllSourceWatches stops every live source watch -- called once
// at shutdown (wiring.RunShutdown), same reasoning
// atlassvc.CloseAllMirrorWatches gives: no watcher goroutine outlives
// the process. Exported for wiring only, never a frontend RPC.
//
//wails:ignore
func (s *SecretService) CloseAllSourceWatches() {
	s.watchMu.Lock()
	defer s.watchMu.Unlock()
	for id, b := range s.sourceWatches {
		_ = b.Close()
		delete(s.sourceWatches, id)
		s.stopSourceDebounceLocked(id)
	}
}
