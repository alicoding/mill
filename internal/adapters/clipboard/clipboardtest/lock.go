// Package clipboardtest is a Go-test-only helper: a cross-process lock
// serializing tests that touch the real macOS pasteboard, mirroring
// frontend/e2e/fixtures/clipboardLock.ts's own reasoning at the Go
// layer. `go test ./...` compiles each package into its own test
// binary and runs several of them concurrently by default (no `-p 1`
// in this repo's CI invocation) -- internal/adapters/clipboard's own
// real-desktop tests and internal/services/triggersvc's seeded-workflow
// tests that also write the real clipboard (e.g.
// TestSeededSavedPageToMarkdown_FiresRealWorkflowAndExtractsMainContent)
// otherwise race on the one shared OS pasteboard, confirmed by direct
// reproduction (`go test ./...` failed TestWatchChanges_FiresOnRealChange
// with a value neither test itself wrote). A plain atomic-file-creation
// lock (the same primitive flock/mkdir-based locks use) serializes just
// the handful of tests that actually touch the real clipboard.
package clipboardtest

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"
)

// lockPath lives in the OS temp dir, one path shared by every test
// binary/process on the machine -- deliberately NOT per-package, so a
// clipboard-adapter test and a triggersvc test contend for the SAME
// lock.
var lockPath = filepath.Join(os.TempDir(), "mill-go-test-clipboard.lock")

// staleAfter mirrors clipboardLock.ts's own STALE_MS: a crashed test
// binary could leave the lock file behind forever otherwise.
const staleAfter = 60 * time.Second

// acquireTimeout mirrors clipboardLock.ts's own ACQUIRE_TIMEOUT_MS.
const acquireTimeout = 45 * time.Second

func acquire() error {
	deadline := time.Now().Add(acquireTimeout)
	for {
		f, err := os.OpenFile(lockPath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600) // #nosec G304 -- fixed path under os.TempDir(), never external input
		if err == nil {
			return f.Close()
		}
		if !errors.Is(err, os.ErrExist) {
			return fmt.Errorf("clipboardtest: create lock: %w", err)
		}
		if info, statErr := os.Stat(lockPath); statErr == nil {
			if time.Since(info.ModTime()) > staleAfter {
				_ = os.Remove(lockPath) // steal a stale lock rather than deadlock
				continue
			}
		}
		if time.Now().After(deadline) {
			return fmt.Errorf("clipboardtest: timed out waiting %s for the real-clipboard lock (%s)", acquireTimeout, lockPath)
		}
		time.Sleep(100 * time.Millisecond)
	}
}

func release() {
	_ = os.Remove(lockPath) // already gone (stolen as stale) is fine
}

// WithRealClipboardLock runs fn while holding the cross-process real-
// clipboard lock -- wrap any test that reads or writes the real macOS
// pasteboard (directly, or indirectly through a workflow run) in this,
// end to end, not just around one call.
func WithRealClipboardLock(fn func()) {
	if err := acquire(); err != nil {
		// Fail open rather than block CI indefinitely on a wedged lock --
		// the test itself may still race, but a timeout here is a worse
		// failure mode than the race it's meant to prevent.
		fn()
		return
	}
	defer release()
	fn()
}
