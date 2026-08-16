package fileread

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// Entry is one filesystem item a bounded Scan found, relative to the
// root it was scanned from.
type Entry struct {
	// RelPath is Entry's location relative to Scan's root, always
	// forward-slash separated regardless of OS (so a caller never has
	// to special-case path.Dir/strings.Split by platform).
	RelPath string
	// ParentRelPath is the containing directory's own RelPath, "" for
	// an entry directly under the scanned root.
	ParentRelPath string
	Name          string
	IsDir         bool
	// Ext is the lowercased extension (including the leading "."),
	// "" for a directory or an extensionless file.
	Ext string
}

// ScanResult is Scan's own return shape -- Entries in a deterministic
// order (each directory's children sorted by name, parents always
// listed before their children) so a repeated scan of unchanged
// content produces byte-identical suggestion previews.
type ScanResult struct {
	Entries   []Entry
	Truncated bool
}

// Scan walks root up to maxDepth levels deep (root's direct children
// are depth 1) and returns at most maxEntries entries -- both files and
// directories count against the cap, and hitting it sets Truncated
// rather than erroring, so a caller can show an honest "there's more"
// notice instead of silently dropping the rest. Hidden entries (a name
// starting with ".") and symlinks are skipped entirely -- a symlink is
// never followed, whether it points inside or outside root, so a
// scan's own bounds can never be escaped by a link a synced folder
// happens to contain. maxDepth/maxEntries <= 0 fall back to Mill's own
// default onboarding-scan caps (docs/goals/0067).
func Scan(root string, maxDepth, maxEntries int) (ScanResult, error) {
	if root == "" {
		return ScanResult{}, fmt.Errorf("fileread: no folder given")
	}
	if maxDepth <= 0 {
		maxDepth = 3
	}
	if maxEntries <= 0 {
		maxEntries = 500
	}

	info, err := os.Lstat(root)
	if err != nil {
		return ScanResult{}, fmt.Errorf("fileread: %w", err)
	}
	if !info.IsDir() {
		return ScanResult{}, fmt.Errorf("fileread: %q is not a folder", root)
	}

	var result ScanResult
	err = scanDir(root, "", 1, maxDepth, maxEntries, &result)
	if err != nil {
		return ScanResult{}, fmt.Errorf("fileread: %w", err)
	}
	return result, nil
}

// scanDir lists dirAbsPath (whose RelPath from Scan's root is
// dirRelPath) and recurses into its own subdirectories while depth
// stays within maxDepth, appending to result.Entries in place. Stops
// (setting result.Truncated) the moment the count cap is hit, including
// mid-directory -- the remaining siblings are simply never visited.
func scanDir(dirAbsPath, dirRelPath string, depth, maxDepth, maxEntries int, result *ScanResult) error {
	items, err := os.ReadDir(dirAbsPath)
	if err != nil {
		return err
	}
	sort.Slice(items, func(i, j int) bool { return items[i].Name() < items[j].Name() })

	for _, item := range items {
		if len(result.Entries) >= maxEntries {
			result.Truncated = true
			return nil
		}
		name := item.Name()
		if strings.HasPrefix(name, ".") {
			continue
		}

		absPath := filepath.Join(dirAbsPath, name)
		// os.DirEntry.Type() reports the LINK bit without following it
		// (unlike Info(), which for a DirEntry from ReadDir already
		// resolves through the link) -- this is the check that keeps a
		// symlink from ever being walked into or reported, in either
		// direction.
		if item.Type()&os.ModeSymlink != 0 {
			continue
		}

		relPath := name
		if dirRelPath != "" {
			relPath = dirRelPath + "/" + name
		}
		entry := Entry{RelPath: relPath, ParentRelPath: dirRelPath, Name: name, IsDir: item.IsDir()}
		if !entry.IsDir {
			entry.Ext = strings.ToLower(filepath.Ext(name))
		}
		result.Entries = append(result.Entries, entry)

		if entry.IsDir && depth < maxDepth {
			if err := scanDir(absPath, relPath, depth+1, maxDepth, maxEntries, result); err != nil {
				return err
			}
			if result.Truncated {
				return nil
			}
		}
	}
	return nil
}
