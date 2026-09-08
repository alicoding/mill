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
// commit's tree carries, not the path's true last-touching commit.
// Its answer never reaches a committed artifact (goal 0397): Report
// never calls it, so the ledger `go generate` writes to userdocs/ is
// always a pure function of tracked content. Only GatherAllCurrency
// below calls it, for a live reader with a real working checkout.
func gatherCurrency(repoRoot, family string) Currency {
	codeSHA, code := gitLastTouch(repoRoot, sourcePaths(repoRoot, family))
	docsSHA, docs := "", time.Time{}
	if page, ok := docPageByFamily[family]; ok {
		docsSHA, docs = gitLastTouch(repoRoot, []string{filepath.Join("userdocs", "reference", page)})
	}
	return Currency{
		CodeCommit:    codeSHA,
		CodeChangedAt: code,
		DocsCommit:    docsSHA,
		DocsChangedAt: docs,
	}
}

// CurrencyRow pairs a family with its git-derived Currency -- the
// dashboard's own live-reader shape, one row per Families() entry.
type CurrencyRow struct {
	Family   string
	Currency Currency
}

// GatherAllCurrency reads every family's Currency from repoRoot's git
// history, in Families() order. Never call this from a code path that
// writes a committed artifact -- its answer differs by branch and by
// checkout depth for the same tracked content; it exists for a live
// reader with a real working checkout, such as the control room
// dashboard's `go run ./internal/docsgen/gen -currency` entry point.
func GatherAllCurrency(repoRoot string) []CurrencyRow {
	families := Families()
	rows := make([]CurrencyRow, 0, len(families))
	for _, family := range families {
		rows = append(rows, CurrencyRow{Family: family, Currency: gatherCurrency(repoRoot, family)})
	}
	return rows
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

// gitLastTouch answers the sha and committer date of the most recent
// commit touching any of paths, or "" / a zero time when git finds
// none (no history reachable, or none of the paths exist at HEAD).
func gitLastTouch(repoRoot string, paths []string) (sha string, date time.Time) {
	if len(paths) == 0 {
		return "", time.Time{}
	}
	args := append([]string{"-C", repoRoot, "log", "-1", "--format=%H%n%cI", "--"}, paths...)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, "git", args...).Output() // #nosec G204 -- args are fixed flags plus this package's own repo-relative paths, never external input
	if err != nil {
		return "", time.Time{}
	}
	lines := strings.SplitN(strings.TrimSpace(string(out)), "\n", 2)
	if len(lines) != 2 {
		return "", time.Time{}
	}
	t, err := time.Parse(time.RFC3339, strings.TrimSpace(lines[1]))
	if err != nil {
		return "", time.Time{}
	}
	return strings.TrimSpace(lines[0]), t
}
