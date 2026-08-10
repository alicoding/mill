// Package filewatch wraps fsnotify/fsnotify behind Mill's own names, per
// CLAUDE.md's ports/adapters rule for commodity libraries. BSD-3-Clause,
// no cgo, no external daemon -- wraps OS-native syscalls (kqueue on
// macOS) via golang.org/x/sys -- see docs/SPEC.md §3.4.
package filewatch

import (
	"fmt"

	"path/filepath"

	"github.com/fsnotify/fsnotify"
)

// Binding is a live filesystem watch on one path.
type Binding struct {
	watcher *fsnotify.Watcher
	done    chan struct{}
}

// Watch registers a watch on path, calling fn(changedPath) whenever
// fsnotify reports a create/write/remove/rename/chmod event under it.
// pattern is an optional glob (path/filepath.Match syntax, e.g.
// "*.md") matched against the changed file's base name -- empty means
// every event fires. Passing the changed path (rather than a bare
// signal) lets the workflow know WHICH file changed; the pattern makes
// "only .md files" expressible (goal 0001 node maturity). Same
// swap-the-library-freely shape as internal/adapters/hotkey.Bind.
func Watch(path, pattern string, fn func(changedPath string)) (*Binding, error) {
	w, err := fsnotify.NewWatcher()
	if err != nil {
		return nil, fmt.Errorf("filewatch: %w", err)
	}
	if pattern != "" {
		// Validate the glob once, up front, so a bad pattern is a clear
		// arm-time error rather than silently matching nothing forever.
		if _, err := filepath.Match(pattern, "probe"); err != nil {
			_ = w.Close()
			return nil, fmt.Errorf("filewatch: invalid pattern %q: %w", pattern, err)
		}
	}
	if err := w.Add(path); err != nil {
		_ = w.Close()
		return nil, fmt.Errorf("filewatch: watching %q: %w", path, err)
	}

	b := &Binding{watcher: w, done: make(chan struct{})}
	go func() {
		for {
			select {
			case ev, ok := <-w.Events:
				if !ok {
					return
				}
				if pattern != "" {
					if match, _ := filepath.Match(pattern, filepath.Base(ev.Name)); !match {
						continue
					}
				}
				fn(ev.Name)
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
