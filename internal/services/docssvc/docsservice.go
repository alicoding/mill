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
// the closed list is the traversal guard, not path cleaning. Rendered
// through RenderDocsHTML (not the shared RenderHTML every other
// markdown consumer uses) so every heading carries a stable id -- the
// TOC rail and heading-anchor links resolve against it.
func (d *DocsService) DocPageHTML(rel string) (string, error) {
	raw, err := d.readIndexedPage(rel)
	if err != nil {
		return "", err
	}
	html, err := markdown.RenderDocsHTML(string(raw))
	if err != nil {
		return "", fmt.Errorf("render docs page: %w", err)
	}
	return html, nil
}

func (d *DocsService) readIndexedPage(rel string) ([]byte, error) {
	known := false
	for _, p := range docsgen.PageIndex() {
		if p.Rel == rel {
			known = true
			break
		}
	}
	if !known {
		return nil, fmt.Errorf("no docs page %q", rel)
	}
	raw, err := fs.ReadFile(d.content, "userdocs/"+rel)
	if err != nil {
		return nil, fmt.Errorf("read docs page: %w", err)
	}
	return raw, nil
}

// DocSearchEntry is one page's contribution to the client-side search
// index: title plus the page's full text (rendered then stripped to
// plain text, so matches land on prose, not markdown syntax).
type DocSearchEntry struct {
	Rel   string `json:"rel"`
	Title string `json:"title"`
	Text  string `json:"text"`
}

// DocsSearchIndex serves every indexed page's full text in one call --
// the offline, client-side `docs.search` command builds its match
// index from this, computed once per session rather than re-fetched
// per keystroke.
func (d *DocsService) DocsSearchIndex() ([]DocSearchEntry, error) {
	pages := docsgen.PageIndex()
	out := make([]DocSearchEntry, 0, len(pages))
	for _, p := range pages {
		raw, err := d.readIndexedPage(p.Rel)
		if err != nil {
			return nil, err
		}
		html, err := markdown.RenderDocsHTML(string(raw))
		if err != nil {
			return nil, fmt.Errorf("render docs page %q: %w", p.Rel, err)
		}
		out = append(out, DocSearchEntry{Rel: p.Rel, Title: p.Title, Text: markdown.PlainText(html)})
	}
	return out, nil
}
