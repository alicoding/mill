// Package dotenvsource reads dotenv files for the "env" secret provider
// (ADR-0050) through the converged Go parser, never a hand-rolled one:
// quoting, escapes, and ${VAR} expansion follow what every other
// dotenv consumer expects.
package dotenvsource

import (
	"errors"
	"fmt"
	"os"
	"sort"

	"github.com/joho/godotenv"
)

// ErrMissing wraps Read's own error when path names no file --
// errors.Is-comparable, so a caller (secretsvc's SourceProblems) can
// tell "the file isn't there" apart from any other read failure
// (permission denied, malformed content) without parsing this
// package's error text.
var ErrMissing = errors.New("dotenvsource: file missing")

// Read parses the file into its key/value pairs. The file is read on
// every call -- a value is never cached, the same posture as every
// other provider (the store stays the source of truth).
func Read(path string) (map[string]string, error) {
	values, err := godotenv.Read(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, fmt.Errorf("dotenv file %q is missing: %w", path, ErrMissing)
		}
		return nil, fmt.Errorf("dotenv file %q: %w", path, err)
	}
	return values, nil
}

// Keys lists the file's keys, sorted -- what a picker shows; never a
// value.
func Keys(path string) ([]string, error) {
	values, err := Read(path)
	if err != nil {
		return nil, err
	}
	keys := make([]string, 0, len(values))
	for k := range values {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys, nil
}
