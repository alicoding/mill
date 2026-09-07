// Package dotenvscan finds the dotenv files under a folder the user
// chose (goal 0306 S4). Deliberately narrow: it never scans without a
// folder, never walks more than a few levels down, and never descends
// into the directories a project fills with other people's code --
// a credential scanner that wandered a whole home directory would be
// the thing ADR-0050 refuses, not a convenience.
package dotenvscan

import (
	"fmt"
	"io/fs"
	"path/filepath"
	"sort"
	"strings"

	"github.com/alicoding/mill/internal/adapters/dotenvsource"
)

// MaxDepth bounds how far below the chosen folder the walk goes.
const MaxDepth = 4

// skippedDirs never contribute: dependency and build trees hold other
// people's files, and .git holds history rather than configuration.
var skippedDirs = map[string]bool{
	"node_modules": true, ".git": true, "vendor": true, "dist": true,
}

// Found is one dotenv file the walk turned up: its path relative to
// the chosen folder, its absolute path, and how many keys it holds.
type Found struct {
	RelPath string
	Path    string
	Keys    int
}

// Skipped is one file whose NAME is dotenv-shaped but whose content
// could not be parsed -- named with its reason rather than silently
// omitted, so a scan result never pretends such a file was not there.
type Skipped struct {
	RelPath string
	Path    string
	Reason  string
}

// IsDotenvName reports whether a file name is a dotenv file: ".env",
// any ".env.<something>", or any "<something>.env".
func IsDotenvName(name string) bool {
	return name == ".env" || strings.HasPrefix(name, ".env.") || (strings.HasSuffix(name, ".env") && name != ".env")
}

// Scan walks root to MaxDepth and returns every dotenv file under it,
// sorted by relative path, plus every dotenv-named file that failed to
// parse with its reason. An empty root is refused rather than
// defaulted -- there is no folder Mill may scan without being told.
func Scan(root string) ([]Found, []Skipped, error) {
	if strings.TrimSpace(root) == "" {
		return nil, nil, fmt.Errorf("choose a folder to scan first")
	}
	cleanRoot := filepath.Clean(root)
	var out []Found
	var skipped []Skipped
	err := filepath.WalkDir(cleanRoot, func(path string, d fs.DirEntry, walkErr error) error {
		return visit(cleanRoot, path, d, walkErr, &out, &skipped)
	})
	if err != nil {
		return nil, nil, fmt.Errorf("scan %s: %w", filepath.Base(cleanRoot), err)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].RelPath < out[j].RelPath })
	sort.Slice(skipped, func(i, j int) bool { return skipped[i].RelPath < skipped[j].RelPath })
	return out, skipped, nil
}

// visit judges one walked entry: an unreadable subtree is skipped
// rather than fatal (one permission-denied folder must not lose the
// whole scan), a directory is judged by dirDecision, and a dotenv file
// joins the results with its key count -- or the skipped list with its
// parse reason when it could not be read.
func visit(root, path string, d fs.DirEntry, walkErr error, out *[]Found, skipped *[]Skipped) error {
	if walkErr != nil {
		if d != nil && d.IsDir() {
			return filepath.SkipDir
		}
		return nil
	}
	rel, relErr := filepath.Rel(root, path)
	if relErr != nil {
		return nil
	}
	if d.IsDir() {
		return dirDecision(rel, d.Name())
	}
	if !IsDotenvName(d.Name()) {
		return nil
	}
	keys, err := dotenvsource.Keys(path)
	if err != nil {
		*skipped = append(*skipped, Skipped{RelPath: filepath.ToSlash(rel), Path: path, Reason: parseReason(path, err)})
		return nil
	}
	*out = append(*out, Found{RelPath: filepath.ToSlash(rel), Path: path, Keys: len(keys)})
	return nil
}

// parseReason distills a dotenv-source read failure to the parse cause
// alone: the wrapper's own "dotenv file <path>:" lead names the path,
// which the scan row already carries, so only the remainder is shown.
func parseReason(path string, err error) string {
	if wrapped := strings.TrimPrefix(err.Error(), fmt.Sprintf("dotenv file %q: ", path)); wrapped != err.Error() {
		return wrapped
	}
	return err.Error()
}

// dirDecision judges one directory: the root itself is always walked;
// a dependency, build or hidden directory is skipped whole; anything
// at or beyond MaxDepth is skipped whole.
func dirDecision(rel, name string) error {
	if rel == "." {
		return nil
	}
	if skippedDirs[name] || strings.HasPrefix(name, ".") {
		return filepath.SkipDir
	}
	if depth(rel) >= MaxDepth {
		return filepath.SkipDir
	}
	return nil
}

func depth(rel string) int { return len(strings.Split(filepath.ToSlash(rel), "/")) }

// SourceLabel names a found file the way the Sources list shows it:
// the parent folder and the file, so two projects' .env files never
// read as the same source.
func SourceLabel(root string, f Found) string {
	dir := filepath.Dir(filepath.Join(filepath.Clean(root), filepath.FromSlash(f.RelPath)))
	return filepath.Base(dir) + "/" + filepath.Base(f.RelPath)
}

// ImportTag is the tag every key imported out of a found file carries:
// the folder it came from, so an import stays traceable to its origin.
func ImportTag(root string, f Found) string {
	dir := filepath.Dir(filepath.Join(filepath.Clean(root), filepath.FromSlash(f.RelPath)))
	return filepath.Base(dir)
}
