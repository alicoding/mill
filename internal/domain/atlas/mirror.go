package atlas

import (
	"path/filepath"
	"strings"
)

// MirrorKind classifies a mirrored file for the card overlay's preview
// (docs/goals/0064): a pure, extension-only decision, no I/O -- the
// service layer (atlassvc) is what actually stats/reads the file this
// classifies.
type MirrorKind string

const (
	// MirrorKindMarkdown renders through the markdown adapter to HTML.
	MirrorKindMarkdown MirrorKind = "markdown"
	// MirrorKindText renders as plain, preformatted text.
	MirrorKindText MirrorKind = "text"
	// MirrorKindImage renders inline as an image.
	MirrorKindImage MirrorKind = "image"
	// MirrorKindOther never has its content loaded -- the overlay shows
	// only its kind and size, plus the existing reveal-file action.
	MirrorKindOther MirrorKind = "other"
)

var markdownExtensions = map[string]bool{
	".md": true, ".markdown": true,
}

// imageMimeTypes is also the image-extension allow-list -- an
// extension present here is both "this is an image" and "this is its
// MIME type," so the two can never drift apart into two separate
// lists.
var imageMimeTypes = map[string]string{
	".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
	".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml",
	".bmp": "image/bmp",
}

// textExtensions is a conservative allow-list, not every extension a
// text editor might open -- an unrecognized extension falls back to
// MirrorKindOther's type+size+reveal treatment rather than risking an
// actually-binary file being decoded and rendered as garbled text.
var textExtensions = map[string]bool{
	".txt": true, ".log": true, ".json": true, ".yaml": true, ".yml": true,
	".csv": true, ".tsv": true, ".xml": true, ".ini": true, ".conf": true,
	".toml": true, ".sh": true, ".env": true,
}

// ClassifyMirrorKind decides how path's content should render, from
// its extension alone (case-insensitive).
func ClassifyMirrorKind(path string) MirrorKind {
	ext := strings.ToLower(filepath.Ext(path))
	switch {
	case markdownExtensions[ext]:
		return MirrorKindMarkdown
	case imageMimeTypes[ext] != "":
		return MirrorKindImage
	case textExtensions[ext]:
		return MirrorKindText
	default:
		return MirrorKindOther
	}
}

// MirrorImageMimeType returns path's image MIME type, or "" if its
// extension isn't a recognized image type.
func MirrorImageMimeType(path string) string {
	return imageMimeTypes[strings.ToLower(filepath.Ext(path))]
}

// MirrorContent is a card's MirrorPath resolved into a read-only
// overlay preview (docs/goals/0064), returned by atlassvc.AtlasService.
// MirrorContent. Size is always populated (even when TooLarge or
// Kind==MirrorKindOther) so the overlay's type+size+reveal fallback
// always has something to show. Content holds rendered HTML for
// MirrorKindMarkdown, raw text for MirrorKindText, or base64-encoded
// bytes (paired with MimeType) for MirrorKindImage -- empty for
// MirrorKindOther or whenever TooLarge is true.
type MirrorContent struct {
	Kind     MirrorKind
	MimeType string
	Size     int64
	Content  string
	TooLarge bool
}
