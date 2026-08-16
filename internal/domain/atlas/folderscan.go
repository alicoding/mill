package atlas

import "strings"

// ScanCategory is the heuristic bucket a synced-folder scan's own
// suggestion preview groups an entry under (docs/goals/0067) -- a
// presentation grouping only, never a Kind: which real Kind each
// bucket's accepted entries become is a choice the user makes in the
// preview (ADR-0038 Decision 2 -- nothing may assume a specific seeded
// Kind exists, since every Kind is user-owned, editable, deletable
// data).
type ScanCategory string

const (
	// ScanCategoryContainer is a directory -- becomes a container card
	// (ViewMode shelves) holding whatever of its own contents were
	// accepted.
	ScanCategoryContainer ScanCategory = "container"
	// ScanCategoryImage is a file whose extension is a common image
	// format.
	ScanCategoryImage ScanCategory = "image"
	// ScanCategoryFile is every other file -- text/markdown/office/PDF
	// documents and anything unrecognized alike, since an unfamiliar
	// extension is still worth suggesting as a plain reference rather
	// than silently excluded.
	ScanCategoryFile ScanCategory = "file"
)

// scanImageExtensions is the same kind of extension allow-list
// mirror.go's imageMimeTypes keeps for the overlay preview -- kept
// separate (rather than reused directly) since this classification
// runs over entries mirror.go never sees yet (nothing has a MirrorPath
// until import actually happens).
var scanImageExtensions = map[string]bool{
	".png": true, ".jpg": true, ".jpeg": true, ".gif": true, ".webp": true,
	".svg": true, ".bmp": true, ".heic": true, ".tif": true, ".tiff": true,
}

// ClassifyScanExtension buckets ext (as fileread.Entry.Ext already
// lowercases it, including the leading ".") into a ScanCategory --
// pure and total: every extension, known or not, lands somewhere.
func ClassifyScanExtension(ext string) ScanCategory {
	if scanImageExtensions[strings.ToLower(ext)] {
		return ScanCategoryImage
	}
	return ScanCategoryFile
}

// HumanizeFilename turns a filesystem name into a suggested card
// title: strips the extension, replaces "-"/"_" separators with
// spaces, and capitalizes the first letter of each resulting word --
// "meeting_notes-v2.md" -> "Meeting Notes V2". Pure and total; an
// empty or all-separator name returns "" (the caller falls back to the
// raw filename rather than proposing a blank title).
func HumanizeFilename(name string) string {
	stem := name
	if dot := strings.LastIndex(name, "."); dot > 0 {
		stem = name[:dot]
	}
	fields := strings.FieldsFunc(stem, func(r rune) bool { return r == '-' || r == '_' || r == ' ' })
	for i, f := range fields {
		fields[i] = capitalizeWord(f)
	}
	return strings.Join(fields, " ")
}

func capitalizeWord(w string) string {
	if w == "" {
		return w
	}
	r := []rune(w)
	if r[0] >= 'a' && r[0] <= 'z' {
		r[0] -= 'a' - 'A'
	}
	return string(r)
}
