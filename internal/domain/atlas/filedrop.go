package atlas

import (
	"path/filepath"
	"strings"
)

// DropCategory buckets a dropped file's extension for the instant
// single-file landing door (goal 0081 slice A3, LOCKED design §3b): a
// pure, extension-only classification, no I/O -- the service layer
// (atlassvc) resolves a category to an actual Kind ID.
type DropCategory string

const (
	// DropCategoryProse is a prose/document-family extension (markdown,
	// plain text, office/PDF formats).
	DropCategoryProse DropCategory = "prose"
	// DropCategoryOther is everything else -- still worth capturing as
	// a plain reference rather than refused.
	DropCategoryOther DropCategory = "other"
)

// dropProseExtensions is the prose/document-family allow-list the
// LOCKED design names explicitly (.md/.markdown/.txt/.docx/.pdf and
// similar) -- deliberately a superset close to mirror.go's
// markdownExtensions/textExtensions, but its own list: this
// classification runs at drop time, before any mirror content is ever
// read.
var dropProseExtensions = map[string]bool{
	".md": true, ".markdown": true, ".txt": true, ".docx": true, ".pdf": true,
	".doc": true, ".rtf": true, ".odt": true, ".pages": true,
}

// ClassifyDropExtension buckets ext (lowercased, including the leading
// ".") into a DropCategory -- pure and total: every extension, known
// or not, lands somewhere.
func ClassifyDropExtension(ext string) DropCategory {
	if dropProseExtensions[strings.ToLower(ext)] {
		return DropCategoryProse
	}
	return DropCategoryOther
}

// ClassifyDropPath is ClassifyDropExtension applied to a full path.
func ClassifyDropPath(path string) DropCategory {
	return ClassifyDropExtension(filepath.Ext(path))
}
