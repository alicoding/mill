// Package filewatch wraps fsnotify/fsnotify behind Mill's own names, per
// CLAUDE.md's ports/adapters rule for commodity libraries. BSD-3-Clause,
// no cgo, no external daemon -- wraps OS-native syscalls (kqueue on
// macOS) via golang.org/x/sys -- see docs/SPEC.md §3.4.
package filewatch

import (
	"fmt"

	"github.com/fsnotify/fsnotify"
)

// Binding is a live filesystem watch on one path.
type Binding struct {
	watcher *fsnotify.Watcher
	done    chan struct{}
}

// Watch registers a watch on path, calling fn whenever fsnotify reports a
// create/write/remove/rename/chmod event under it. Forwards the
// library's own event stream into an opaque callback, same "swapping the
// underlying library later never changes this method's signature" shape
// as internal/adapters/hotkey.Bind.
func Watch(path string, fn func()) (*Binding, error) {
	w, err := fsnotify.NewWatcher()
	if err != nil {
		return nil, fmt.Errorf("filewatch: %w", err)
	}
	if err := w.Add(path); err != nil {
		_ = w.Close()
		return nil, fmt.Errorf("filewatch: watching %q: %w", path, err)
	}

	b := &Binding{watcher: w, done: make(chan struct{})}
	go func() {
		for {
			select {
			case _, ok := <-w.Events:
				if !ok {
					return
				}
				fn()
			case _, ok := <-w.Errors:
				if !ok {
					return
				}
				// Errors are surfaced by the watcher closing, not
				// individually -- a single bad event shouldn't tear
				// down the whole watch.
			case <-b.done:
				return
			}
		}
	}()
	return b, nil
}

// Close unregisters the watch and releases its OS-level resources.
func (b *Binding) Close() error {
	close(b.done)
	return b.watcher.Close()
}
