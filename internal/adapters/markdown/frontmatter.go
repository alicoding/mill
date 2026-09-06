package markdown

import (
	"fmt"
	"strings"

	"gopkg.in/yaml.v3"
)

// FrontMatter is a docs page's leading YAML block: the text between an
// opening `---` on line one and the next `---` line, the shape every
// static-site generator reads. Fields decodes as a flat string map --
// the docs tree declares scalar keys only (`kind`, a skill's `name`).
type FrontMatter struct {
	Fields map[string]string
	// Body is the markdown after the closing delimiter; the whole
	// source when there is no front matter at all.
	Body string
}

// SplitFrontMatter separates a page's YAML front matter from its
// markdown body. A source that does not open with `---` has no front
// matter (empty Fields, Body == source). An opening delimiter with no
// closing one is an error, never silently rendered as a paragraph.
func SplitFrontMatter(source string) (FrontMatter, error) {
	const delimiter = "---"
	if !strings.HasPrefix(source, delimiter+"\n") && !strings.HasPrefix(source, delimiter+"\r\n") {
		return FrontMatter{Fields: map[string]string{}, Body: source}, nil
	}
	rest := source[len(delimiter):]
	rest = strings.TrimPrefix(strings.TrimPrefix(rest, "\r"), "\n")
	end := -1
	if strings.HasPrefix(rest, delimiter+"\n") || strings.HasPrefix(rest, delimiter+"\r\n") || rest == delimiter {
		end = 0
	} else if i := strings.Index(rest, "\n"+delimiter+"\n"); i != -1 {
		end = i + 1
	} else if i := strings.Index(rest, "\n"+delimiter+"\r\n"); i != -1 {
		end = i + 1
	} else if strings.HasSuffix(rest, "\n"+delimiter) {
		end = len(rest) - len(delimiter)
	}
	if end == -1 {
		return FrontMatter{}, fmt.Errorf("markdown: front matter opened with --- but never closed")
	}
	block := rest[:end]
	body := rest[end+len(delimiter):]
	body = strings.TrimPrefix(strings.TrimPrefix(body, "\r"), "\n")
	fields := map[string]string{}
	if strings.TrimSpace(block) != "" {
		if err := yaml.Unmarshal([]byte(block), &fields); err != nil {
			return FrontMatter{}, fmt.Errorf("markdown: front matter: %w", err)
		}
	}
	return FrontMatter{Fields: fields, Body: body}, nil
}
