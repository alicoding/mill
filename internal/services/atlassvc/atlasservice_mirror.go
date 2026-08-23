package atlassvc

import (
	"encoding/base64"
	"fmt"

	"github.com/alicoding/mill/internal/adapters/fileread"
	"github.com/alicoding/mill/internal/adapters/markdown"
	"github.com/alicoding/mill/internal/domain/atlas"
)

// mirrorPreviewMaxBytes caps how much of a mirrored file the overlay
// actually loads and sends to the frontend (docs/goals/0064) --
// smaller than fileread.MaxBytes (the raw workflow-ingestion cap)
// because this path also base64-encodes image bytes and renders
// markdown to HTML, both of which inflate an already-sizable payload
// further before it ever reaches the browser. A file over this cap
// reports its kind and size (TooLarge) without its content ever being
// read into memory.
const mirrorPreviewMaxBytes = 5 * 1024 * 1024 // 5MB

// MirrorContent resolves cardID's MirrorPath into a read-only overlay
// preview: markdown renders to HTML, plain text passes through as-is,
// an image becomes base64-encoded bytes paired with its MIME type, and
// anything else (or anything over mirrorPreviewMaxBytes) reports only
// its kind and size -- the overlay's existing reveal-file action is
// what a user reaches for beyond that.
func (a *AtlasService) MirrorContent(cardID string) (atlas.MirrorContent, error) {
	a.mu.RLock()
	idx := a.findCardLocked(cardID)
	if idx == -1 {
		a.mu.RUnlock()
		return atlas.MirrorContent{}, fmt.Errorf("no card with id %q", cardID)
	}
	path := a.cards[idx].MirrorPath
	a.mu.RUnlock()
	if path == "" {
		return atlas.MirrorContent{}, fmt.Errorf("card %q has no mirrored file", cardID)
	}

	size, err := fileread.Stat(path)
	if err != nil {
		return atlas.MirrorContent{}, fmt.Errorf("mirror content: %w", err)
	}
	kind := atlas.ClassifyMirrorKind(path)
	out := atlas.MirrorContent{Kind: kind, Size: size}
	if kind == atlas.MirrorKindOther {
		return out, nil
	}
	if size > mirrorPreviewMaxBytes {
		out.TooLarge = true
		return out, nil
	}

	raw, err := fileread.Read(path)
	if err != nil {
		return atlas.MirrorContent{}, fmt.Errorf("mirror content: %w", err)
	}

	switch kind {
	case atlas.MirrorKindMarkdown:
		html, err := markdown.RenderHTML(raw)
		if err != nil {
			return atlas.MirrorContent{}, fmt.Errorf("mirror content: %w", err)
		}
		out.Content = html
	case atlas.MirrorKindText:
		out.Content = raw
	case atlas.MirrorKindImage:
		out.MimeType = atlas.MirrorImageMimeType(path)
		out.Content = base64.StdEncoding.EncodeToString([]byte(raw))
	case atlas.MirrorKindOther:
		// Unreachable (handled above) -- listed so this switch stays
		// exhaustive against MirrorKind's own declared values.
	}
	return out, nil
}

// MirrorRawBytes returns cardID's mirrored file as base64-encoded raw
// bytes, regardless of MirrorKind (the Export-as "Original file"
// default every mirror-bearing card gets, ADR-0043 §3/goal 0133).
// MirrorContent above deliberately withholds content for
// MirrorKindOther -- a PREVIEW safety gate answering "is this safe to
// interpret as text/HTML" -- but handing raw bytes back for direct
// download, never parsed or rendered by Mill itself, carries none of
// that risk, so this method applies the same size cap without the kind
// gate.
func (a *AtlasService) MirrorRawBytes(cardID string) (string, error) {
	a.mu.RLock()
	idx := a.findCardLocked(cardID)
	if idx == -1 {
		a.mu.RUnlock()
		return "", fmt.Errorf("no card with id %q", cardID)
	}
	path := a.cards[idx].MirrorPath
	a.mu.RUnlock()
	if path == "" {
		return "", fmt.Errorf("card %q has no mirrored file", cardID)
	}

	size, err := fileread.Stat(path)
	if err != nil {
		return "", fmt.Errorf("mirror raw bytes: %w", err)
	}
	if size > mirrorPreviewMaxBytes {
		return "", fmt.Errorf("mirror raw bytes: %q is %d bytes, over the %d byte export limit", path, size, mirrorPreviewMaxBytes)
	}

	raw, err := fileread.Read(path)
	if err != nil {
		return "", fmt.Errorf("mirror raw bytes: %w", err)
	}
	return base64.StdEncoding.EncodeToString([]byte(raw)), nil
}
