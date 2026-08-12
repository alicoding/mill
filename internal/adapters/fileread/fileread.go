// Package fileread wraps local-file reading behind Mill's own name
// (CLAUDE.md's ports/adapters rule) -- the adapter behind the
// capture-file NodeType, which reads a saved-page-shaped file (e.g. the
// changed path a filesystem-watch trigger just reported) into the
// workflow's payload.
package fileread

import (
	"fmt"
	"os"
)

// MaxBytes is a hard size guard -- a workflow step reading an
// unexpectedly huge file (a mis-pointed watch path, a giant log) should
// fail loudly and cheaply rather than loading it all into memory. Not
// configurable (docs/SPEC.md §3.5's "no config surface for a decision
// that doesn't exist yet" discipline -- nothing today needs a workflow-
// tunable limit).
const MaxBytes = 10 * 1024 * 1024 // 10MB

// Read returns path's contents as a string. Errors clearly on a missing
// file, an empty path, and a file over MaxBytes (checked via os.Stat
// before reading, so an oversized file is never actually loaded into
// memory just to be rejected).
func Read(path string) (string, error) {
	if path == "" {
		return "", fmt.Errorf("fileread: no path given")
	}

	info, err := os.Stat(path)
	if err != nil {
		return "", fmt.Errorf("fileread: %w", err)
	}
	if info.IsDir() {
		return "", fmt.Errorf("fileread: %q is a directory, not a file", path)
	}
	if info.Size() > MaxBytes {
		return "", fmt.Errorf("fileread: %q is %d bytes, over the %d byte limit", path, info.Size(), MaxBytes)
	}

	// path is a user-configured value (the capture-file node's path,
	// which composition.go registers as guardrail.ClassRead) -- reading
	// an arbitrary path IS this connector's job; the node's own step
	// already goes through Mill's guardrail preview/approval gate before
	// this ever runs, so this is not a missing validation to add here.
	data, err := os.ReadFile(path) //nolint:gosec // guardrail-gated user-configured path, by design (see comment above)
	if err != nil {
		return "", fmt.Errorf("fileread: %w", err)
	}
	return string(data), nil
}
