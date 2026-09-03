// Package todoscan walks a local directory tree looking for
// TODO-style markers in text files -- the adapter behind the
// process-todo-scan NodeType (goal 0285: Go's stdlib walk + regexp,
// no vendored scanner, since a Rust-based one is disqualified by
// SPEC.md §1.1's no-Rust constraint).
package todoscan

import (
	"bufio"
	"bytes"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

// MaxFileBytes caps which files are read for content -- a file over
// this size is skipped rather than loaded in full, the same
// cheap-fail-first shape fileread.MaxBytes uses for capture-file.
const MaxFileBytes = 1024 * 1024 // 1MiB

// binaryProbeBytes is how much of a file's head is checked for a NUL
// byte to decide whether it's binary, before any line scanning.
const binaryProbeBytes = 512

// skipDirNames names directories the walk never enters, in addition to
// any directory whose own name starts with a dot (skipDir).
var skipDirNames = map[string]bool{
	"node_modules": true,
	"vendor":       true,
	"dist":         true,
	"bin":          true,
}

// Match is one marker hit.
type Match struct {
	File   string // relative to the scanned root, forward-slashed
	Line   int
	Marker string
	Text   string
}

// Options configures a Scan.
type Options struct {
	// Markers is the whole-word, case-sensitive list of marker
	// keywords to look for. Required -- empty is a caller error.
	Markers []string
	// Extensions, when non-empty, restricts matching to files whose
	// lowercased extension (no leading dot) is in this list. Empty
	// scans every file that passes the directory/size/binary filters.
	Extensions []string
	// MaxFiles stops the walk once this many regular files (after
	// directory skips, before the extension filter) have been visited.
	// Must be a positive integer.
	MaxFiles int
}

// Scan walks root and returns every marker hit, in walk order. It
// never follows symlinks out of root -- filepath.WalkDir doesn't
// resolve them, and this scanner relies on that rather than adding its
// own symlink handling.
func Scan(root string, opts Options) ([]Match, error) {
	info, err := os.Stat(root)
	if err != nil {
		return nil, fmt.Errorf("todoscan: %w", err)
	}
	if !info.IsDir() {
		return nil, fmt.Errorf("todoscan: %q is not a directory", root)
	}
	if opts.MaxFiles <= 0 {
		return nil, fmt.Errorf("todoscan: maxFiles must be a positive integer")
	}
	pattern, err := markerPattern(opts.Markers)
	if err != nil {
		return nil, err
	}

	w := &walker{root: root, pattern: pattern, extSet: extensionSet(opts.Extensions), maxFiles: opts.MaxFiles}
	if err := filepath.WalkDir(root, w.visit); err != nil {
		return nil, fmt.Errorf("todoscan: %w", err)
	}
	return w.matches, nil
}

// walker holds one Scan call's accumulated state -- split out of Scan
// itself so each decision (directory skip, file-kind filter, the
// MaxFiles cutoff) is its own small method rather than one deeply
// nested WalkDir callback.
type walker struct {
	root     string
	pattern  *regexp.Regexp
	extSet   map[string]bool
	maxFiles int
	seen     int
	matches  []Match
}

func (w *walker) visit(path string, d fs.DirEntry, err error) error {
	if err != nil {
		return err
	}
	if d.IsDir() {
		return w.visitDir(path, d)
	}
	return w.visitFile(path, d)
}

func (w *walker) visitDir(path string, d fs.DirEntry) error {
	if path != w.root && skipDir(d.Name()) {
		return filepath.SkipDir
	}
	return nil
}

func (w *walker) visitFile(path string, d fs.DirEntry) error {
	if !d.Type().IsRegular() {
		return nil
	}
	if len(w.extSet) > 0 && !w.extSet[fileExtension(d.Name())] {
		return nil
	}
	w.seen++
	if w.seen > w.maxFiles {
		return filepath.SkipAll
	}
	fileMatches, err := scanFile(w.root, path, w.pattern)
	if err != nil {
		return err
	}
	w.matches = append(w.matches, fileMatches...)
	return nil
}

// skipDir reports whether a directory named name is never entered.
func skipDir(name string) bool {
	return strings.HasPrefix(name, ".") || skipDirNames[name]
}

// fileExtension returns name's extension, lowercased, without its
// leading dot.
func fileExtension(name string) string {
	return strings.ToLower(strings.TrimPrefix(filepath.Ext(name), "."))
}

// extensionSet normalizes an Options.Extensions list into a lookup
// set. A nil/empty result means "no filter".
func extensionSet(exts []string) map[string]bool {
	if len(exts) == 0 {
		return nil
	}
	set := make(map[string]bool, len(exts))
	for _, e := range exts {
		e = strings.ToLower(strings.TrimPrefix(strings.TrimSpace(e), "."))
		if e != "" {
			set[e] = true
		}
	}
	return set
}

// markerPattern compiles markers into one alternation, each matched as
// a whole word (so "TODOS" never matches "TODO"), followed by an
// optional separator and the rest of the line as its capture group.
func markerPattern(markers []string) (*regexp.Regexp, error) {
	if len(markers) == 0 {
		return nil, fmt.Errorf("todoscan: no markers given")
	}
	parts := make([]string, len(markers))
	for i, m := range markers {
		parts[i] = regexp.QuoteMeta(m)
	}
	return regexp.Compile(`\b(` + strings.Join(parts, "|") + `)\b[:\s-]*(.*)`)
}

// scanFile reads path (already known to be a regular file passing the
// extension filter) and returns every line matching pattern. A file
// over MaxFileBytes, or whose first binaryProbeBytes contain a NUL
// byte, is silently skipped -- not an error, since a folder scan is
// expected to walk past ordinary binary/oversized files.
func scanFile(root, path string, pattern *regexp.Regexp) ([]Match, error) {
	info, err := os.Stat(path)
	if err != nil {
		return nil, fmt.Errorf("stat %q: %w", path, err)
	}
	if info.Size() > MaxFileBytes {
		return nil, nil
	}

	// path comes from filepath.WalkDir over a user-configured folder
	// (the node's own "path" field, guardrail-gated like every other
	// user-configured path this package reads -- see fileread.Read's
	// identical comment).
	f, err := os.Open(path) //nolint:gosec // guardrail-gated user-configured folder walk, by design
	if err != nil {
		return nil, fmt.Errorf("open %q: %w", path, err)
	}
	defer func() { _ = f.Close() }()

	head := make([]byte, binaryProbeBytes)
	n, _ := io.ReadFull(f, head)
	if bytes.IndexByte(head[:n], 0) >= 0 {
		return nil, nil
	}
	if _, err := f.Seek(0, io.SeekStart); err != nil {
		return nil, fmt.Errorf("seek %q: %w", path, err)
	}

	rel, err := filepath.Rel(root, path)
	if err != nil {
		return nil, fmt.Errorf("relativize %q: %w", path, err)
	}
	rel = filepath.ToSlash(rel)

	var out []Match
	scanner := bufio.NewScanner(f)
	scanner.Buffer(make([]byte, 0, 64*1024), MaxFileBytes)
	lineNo := 0
	for scanner.Scan() {
		lineNo++
		line := scanner.Text()
		loc := pattern.FindStringSubmatchIndex(line)
		if loc == nil {
			continue
		}
		text := ""
		if loc[4] >= 0 {
			text = strings.TrimSpace(line[loc[4]:loc[5]])
		}
		out = append(out, Match{File: rel, Line: lineNo, Marker: line[loc[2]:loc[3]], Text: text})
	}
	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("scan %q: %w", path, err)
	}
	return out, nil
}
