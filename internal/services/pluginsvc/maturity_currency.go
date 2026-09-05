package pluginsvc

import (
	"context"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"
)

// docPageByFamily names each family's canonical userdocs/reference
// page for Currency's docs-vs-code diff (maturity.go's doc-comment
// table). A family absent here gets a zero DocsChangedAt -- Currency
// falls back to days-since-code-change until a page is named.
var docPageByFamily = map[string]string{
	"canvasObjects": "extending-the-canvas.md",
	"steps":         "steps.md",
	"captures":      "install-a-plugin.md",
	"settings":      "settings.md",
	"network":       "install-a-plugin.md",
	"views":         "install-a-plugin.md",
	"commands":      "commands.md",
	"themes":        "plugin-theming.md",
	"tools":         "install-a-plugin.md",
	"secretSources": "install-a-plugin.md",
}

// gatherCurrency reads git history under repoRoot -- a shallow clone
// (CI's test-go job checks out at fetch-depth 1) answers `git log --
// <path>` with the checkout's own single commit for any path that
// commit's tree carries, not the path's true last-touching commit;
// GenerateMaturity's committed output is therefore generated from a
// full local clone, and the freshness test that guards it excludes
// these fields from its byte comparison (docsgen_maturity_test.go) --
// they are read here for the rendered page and the control-room
// dashboard, both meant to run against a real working checkout.
func gatherCurrency(repoRoot, family string) Currency {
	code := gitLastChanged(repoRoot, sourcePaths(repoRoot, family))
	docs := time.Time{}
	if page, ok := docPageByFamily[family]; ok {
		docs = gitLastChanged(repoRoot, []string{filepath.Join("userdocs", "reference", page)})
	}
	return Currency{
		CodeChangedAt: code,
		DocsChangedAt: docs,
		DaysBehind:    daysBehind(code, docs),
	}
}

// sourcePaths lists the files (relative to repoRoot) that implement a
// family: pluginservice*.go files referencing its Go field name as a
// whole word, plus frontend/src/plugins/** files naming its json key
// as a whole word.
func sourcePaths(repoRoot, family string) []string {
	paths := pluginserviceSourcePaths(repoRoot, family)
	paths = append(paths, frontendPluginSourcePaths(repoRoot, family)...)
	sort.Strings(paths)
	return paths
}

// pluginserviceSourcePaths finds every non-test pluginservice*.go file
// referencing family's Go field name as a whole word.
func pluginserviceSourcePaths(repoRoot, family string) []string {
	fieldName := familyFieldName(family)
	if fieldName == "" {
		return nil
	}
	reField := regexp.MustCompile(`\b` + regexp.QuoteMeta(fieldName) + `\b`)
	matches, _ := filepath.Glob(filepath.Join(repoRoot, "internal", "services", "pluginsvc", "pluginservice*.go"))
	var paths []string
	for _, m := range matches {
		if strings.HasSuffix(m, "_test.go") {
			continue
		}
		if fileMatches(m, reField) {
			paths = append(paths, relPath(repoRoot, m))
		}
	}
	return paths
}

// frontendPluginSourcePaths finds every non-test frontend/src/plugins/**
// .ts/.tsx file naming family's json key as a whole word.
func frontendPluginSourcePaths(repoRoot, family string) []string {
	reFamily := regexp.MustCompile(`\b` + regexp.QuoteMeta(family) + `\b`)
	feRoot := filepath.Join(repoRoot, "frontend", "src", "plugins")
	var paths []string
	_ = filepath.WalkDir(feRoot, func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return nil //nolint:nilerr // a missing/unreadable entry just contributes no evidence
		}
		if !isFrontendSourceFile(p) {
			return nil
		}
		if fileMatches(p, reFamily) {
			paths = append(paths, relPath(repoRoot, p))
		}
		return nil
	})
	return paths
}

func isFrontendSourceFile(p string) bool {
	if strings.HasSuffix(p, ".test.ts") || strings.HasSuffix(p, ".test.tsx") {
		return false
	}
	return strings.HasSuffix(p, ".ts") || strings.HasSuffix(p, ".tsx")
}

func fileMatches(path string, re *regexp.Regexp) bool {
	raw, err := os.ReadFile(path) // #nosec G304 -- path came from this package's own repo-tree glob/walk
	if err != nil {
		return false
	}
	return re.Match(raw)
}

func relPath(repoRoot, p string) string {
	rel, err := filepath.Rel(repoRoot, p)
	if err != nil {
		return p
	}
	return rel
}

// gitLastChanged answers the committer date of the most recent commit
// touching any of paths, or a zero time when git finds none (no
// history reachable, or none of the paths exist at HEAD).
func gitLastChanged(repoRoot string, paths []string) time.Time {
	if len(paths) == 0 {
		return time.Time{}
	}
	args := append([]string{"-C", repoRoot, "log", "-1", "--format=%cI", "--"}, paths...)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, "git", args...).Output() // #nosec G204 -- args are fixed flags plus this package's own repo-relative paths, never external input
	if err != nil {
		return time.Time{}
	}
	s := strings.TrimSpace(string(out))
	if s == "" {
		return time.Time{}
	}
	t, err := time.Parse(time.RFC3339, s)
	if err != nil {
		return time.Time{}
	}
	return t
}
