//go:build server || !darwin

package filetrash

import (
	"fmt"
	"os"
	"path/filepath"
	"time"
)

// trash without a desktop Trash to reach: the item moves into a
// `.trash` folder BESIDE its own parent, timestamped so a second
// removal of the same name never overwrites the first. Recoverable by
// hand, which is the whole property the real Trash provides -- a
// server-mode instance has no Finder to offer "Put Back".
func trash(path string) (string, error) {
	abs, err := filepath.Abs(path)
	if err != nil {
		return "", err
	}
	dir := filepath.Join(filepath.Dir(abs), ".trash")
	if err := os.MkdirAll(dir, 0o750); err != nil {
		return "", fmt.Errorf("create trash directory: %w", err)
	}
	dest := filepath.Join(dir, fmt.Sprintf("%s-%s", filepath.Base(abs), time.Now().UTC().Format("20060102T150405")))
	if err := os.Rename(abs, dest); err != nil {
		return "", fmt.Errorf("move to trash: %w", err)
	}
	return dest, nil
}
