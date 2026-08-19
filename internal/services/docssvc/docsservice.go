// Package docssvc is the in-app Docs surface's bounded context (goal
// 0125 phase 1): serves the embedded userdocs tree -- the SAME
// markdown the repository publishes and the llms.txt index names --
// rendered through the shared markdown adapter. Content arrives as an
// embed.FS injected from main.go (go:embed paths are package-relative,
// and userdocs/ lives at the repo root beside frontend/dist's own
// embed), the established construction-injection shape.
package docssvc

import (
	"fmt"
	"io/fs"

	"github.com/alicoding/mill/internal/adapters/markdown"
	"github.com/alicoding/mill/internal/docsgen"
)

type DocsService struct {
	content fs.FS
}

func New(content fs.FS) *DocsService {
	return &DocsService{content: content}
}

// DocsIndexEntry is one nav row, in reading order.
type DocsIndexEntry struct {
	Rel   string `json:"rel"`
	Title string `json:"title"`
	Note  string `json:"note"`
}

// DocsIndex returns the canonical reading order -- the same list the
// llms.txt generator publishes, so in-app nav and the AI index can
// never disagree.
func (d *DocsService) DocsIndex() []DocsIndexEntry {
	pages := docsgen.PageIndex()
	out := make([]DocsIndexEntry, 0, len(pages))
	for _, p := range pages {
		out = append(out, DocsIndexEntry{Rel: p.Rel, Title: p.Title, Note: p.Note})
	}
	return out
}

// DocPageHTML renders one indexed page. rel must be an index entry --
// the closed list is the traversal guard, not path cleaning.
func (d *DocsService) DocPageHTML(rel string) (string, error) {
	known := false
	for _, p := range docsgen.PageIndex() {
		if p.Rel == rel {
			known = true
			break
		}
	}
	if !known {
		return "", fmt.Errorf("no docs page %q", rel)
	}
	raw, err := fs.ReadFile(d.content, "userdocs/"+rel)
	if err != nil {
		return "", fmt.Errorf("read docs page: %w", err)
	}
	html, err := markdown.RenderHTML(string(raw))
	if err != nil {
		return "", fmt.Errorf("render docs page: %w", err)
	}
	return html, nil
}
