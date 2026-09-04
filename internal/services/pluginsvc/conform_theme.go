package pluginsvc

import (
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

// The theme half of the conformance contract (goal 0320 S3): a plugin's
// styling must come from the variables Mill documents, so its surface
// follows the user's color scheme instead of freezing one palette.
// userdocs/reference/plugin-theming.md is the published list; this file
// is what enforces it, over both the .css a plugin ships and the inline
// style strings its .js writes (Mill's own examples style entirely from
// JavaScript, so checking .css alone would check nothing).

// ThemeVariables is the documented vocabulary. A reference to any other
// custom property is a failure: nothing outside this list is promised to
// exist in every scheme.
var ThemeVariables = map[string]bool{
	// Mill's own.
	"--mill-accent-emphasis":     true,
	"--mill-accent-fg":           true,
	"--mill-accent-muted":        true,
	"--mill-accent-border-muted": true,
	"--mill-kind-trigger":        true,
	"--mill-kind-capture":        true,
	"--mill-kind-process":        true,
	"--mill-kind-apply":          true,
	"--mill-kind-decision":       true,
	"--mill-kind-terminal":       true,
	"--mill-mono":                true,
	// The design system Mill's own interface is built on.
	"--fgColor-default":             true,
	"--fgColor-muted":               true,
	"--bgColor-default":             true,
	"--bgColor-muted":               true,
	"--borderColor-default":         true,
	"--fgColor-accent":              true,
	"--bgColor-accent-emphasis":     true,
	"--fgColor-onEmphasis":          true,
	"--borderColor-accent-emphasis": true,
}

var (
	varRefRe = regexp.MustCompile(`var\(\s*(--[A-Za-z0-9_-]+)`)
	varDefRe = regexp.MustCompile(`(--[A-Za-z0-9_-]+)\s*:`)
	// A color literal in a style context. Anchored on the CSS property
	// that precedes it so a hex-looking id or a URL fragment elsewhere in
	// a script is not mistaken for a color.
	colorLiteralRe = regexp.MustCompile(`(?i)(color|background|background-color|border|border-color|box-shadow|fill|stroke|outline)\s*:\s*[^;"'\n]*?(#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\))`)
)

// conformTheme reads the plugin folder's .css and .js files. Problems
// fail the check; warnings are advice the author decides on (a literal
// is legitimate for content the user authored, wrong for chrome).
func conformTheme(dir string) (problems, warnings []string) {
	root, err := filepath.Abs(dir)
	if err != nil {
		return []string{fmt.Sprintf("cannot resolve %q: %v", dir, err)}, nil
	}
	referenced := map[string]bool{}
	defined := map[string]bool{}
	literals := map[string]int{}
	// The walk only lists; every read happens after it, so no filesystem
	// operation runs against a path the walk is still resolving.
	for _, rel := range themeSourceFiles(root) {
		raw, readErr := os.ReadFile(filepath.Join(root, rel)) // #nosec G304 -- a file the walk of the caller's own plugin folder listed
		if readErr != nil {
			continue
		}
		scanThemeSource(string(raw), rel, referenced, defined, literals)
	}
	for name := range referenced {
		if ThemeVariables[name] || defined[name] {
			continue
		}
		problems = append(problems, fmt.Sprintf("%s is neither a documented theme variable nor defined by this plugin -- see the plugin theming reference", name))
	}
	for rel, n := range literals {
		warnings = append(warnings, fmt.Sprintf("%s: %d hardcoded color(s) -- a literal will not follow the user's color scheme", rel, n))
	}
	sort.Strings(problems)
	sort.Strings(warnings)
	return problems, warnings
}

// themeSourceFiles lists the folder's styling sources, relative to root.
// vendor/ holds third-party code the author did not write; its palette
// and its own variable namespace are not the plugin's chrome, so it is
// skipped alongside the hidden and dependency directories.
func themeSourceFiles(root string) []string {
	var files []string
	_ = filepath.WalkDir(root, func(path string, d fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return nil
		}
		if d.IsDir() {
			if strings.HasPrefix(d.Name(), ".") || d.Name() == "node_modules" || d.Name() == "vendor" {
				return filepath.SkipDir
			}
			return nil
		}
		if ext := strings.ToLower(filepath.Ext(d.Name())); ext != ".css" && ext != ".js" {
			return nil
		}
		if rel, relErr := filepath.Rel(root, path); relErr == nil {
			files = append(files, rel)
		}
		return nil
	})
	return files
}

// scanThemeSource collects one file's custom-property references and
// definitions, and its hardcoded-color count. A plugin may define and
// read variables of its own; what it may not do is read one it never
// defines and Mill never promises.
func scanThemeSource(src, rel string, referenced, defined map[string]bool, literals map[string]int) {
	for _, m := range varRefRe.FindAllStringSubmatch(src, -1) {
		referenced[m[1]] = true
	}
	for _, m := range varDefRe.FindAllStringSubmatch(src, -1) {
		defined[m[1]] = true
	}
	if n := len(colorLiteralRe.FindAllString(src, -1)); n > 0 {
		literals[rel] = n
	}
}
