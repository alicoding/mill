// Package dotenvsource reads dotenv files for the "env" secret provider
// (ADR-0050) through the converged Go parser, never a hand-rolled one:
// quoting, escapes, and ${VAR} expansion follow what every other
// dotenv consumer expects.
package dotenvsource

import (
	"fmt"
	"os"
	"sort"

	"github.com/joho/godotenv"
)

// Read parses the file into its key/value pairs. The file is read on
// every call -- a value is never cached, the same posture as every
// other provider (the store stays the source of truth).
func Read(path string) (map[string]string, error) {
	values, err := godotenv.Read(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, fmt.Errorf("dotenv file %q is missing", path)
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
