package docsgen

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

var markdownLink = regexp.MustCompile(`\]\(([^)\s]+)\)`)

// Every relative link in README.md and the userdocs tree resolves to a
// file that exists -- a renamed page or a moved section breaks links
// here, not in a reader's browser.
func TestRelativeLinks_Resolve(t *testing.T) {
	root := filepath.Join("..", "..")
	files := []string{filepath.Join(root, "README.md")}
	err := filepath.WalkDir(filepath.Join(root, "userdocs"), func(path string, d os.DirEntry, err error) error {
		if err == nil && !d.IsDir() && strings.HasSuffix(path, ".md") {
			files = append(files, path)
		}
		return err
	})
	if err != nil {
		t.Fatalf("walk userdocs: %v", err)
	}
	for _, file := range files {
		raw, err := os.ReadFile(file) // #nosec G304 -- paths come from this test's own walk of the repo
		if err != nil {
			t.Fatalf("read %s: %v", file, err)
		}
		for _, m := range markdownLink.FindAllStringSubmatch(string(raw), -1) {
			target := m[1]
			if strings.HasPrefix(target, "#") || strings.Contains(target, "://") || strings.HasPrefix(target, "mailto:") {
				continue
			}
			target, _, _ = strings.Cut(target, "#")
			if _, err := os.Stat(filepath.Join(filepath.Dir(file), target)); err != nil { // #nosec G703 -- link targets come from this repo's own committed docs, checked for existence only
				rel, _ := filepath.Rel(root, file)
				t.Errorf("%s links to %q, which does not exist", rel, m[1])
			}
		}
	}
}
