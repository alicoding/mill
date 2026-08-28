package atlassvc

import (
	"context"
	"encoding/base64"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"strings"
	"time"

	"github.com/alicoding/mill/internal/adapters/fileread"
	"github.com/alicoding/mill/internal/domain/atlas"
)

// recognizeImagePaste is the paste chain's image-path/URL entry (goal
// 0179 Slice 0): plain-text paste content that names an image, either
// a local path to a file that actually exists, or an http(s) URL whose
// own path ends in a recognized image extension. Ordered LAST in
// pasteRecognizers -- after the structured shapes (drawio/HTML-table/
// TSV), which all require specific markup a bare path/URL string never
// carries, and before the frontend's own note fallback, which is what
// any ordinary pasted text (including a non-image path) still becomes.
// Reuses the exact SAME mirror-write door a native image drop already
// uses (MirrorImageFromPath/SaveImageBytes, goal 0206's mirror-don't-
// point rule) -- never a second copy path.
func recognizeImagePaste(a *AtlasService, text, _, parentID string, pos atlas.Position) (PasteResult, bool, error) {
	candidate := strings.TrimSpace(text)
	if candidate == "" || strings.ContainsAny(candidate, "\n\r") {
		return PasteResult{}, false, nil
	}

	if u, isImageURL := parsedHTTPURL(candidate); isImageURL {
		return a.recognizeImageURLPaste(u, candidate, parentID, pos)
	}
	return a.recognizeImagePathPaste(candidate, parentID, pos)
}

// parsedHTTPURL reports whether text parses as an absolute http(s)
// URL -- a bare local path (even an absolute one starting with "/")
// never has a Scheme, so this cleanly distinguishes the two paste
// shapes before either one touches the filesystem or the network.
func parsedHTTPURL(text string) (*url.URL, bool) {
	u, err := url.Parse(text)
	if err != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") {
		return nil, false
	}
	return u, true
}

// recognizeImagePathPaste handles the local-file half: a path that
// doesn't exist on disk is just text that happens to end in an image
// extension, not a real paste-an-image gesture -- honest non-match,
// not an error.
func (a *AtlasService) recognizeImagePathPaste(candidate, parentID string, pos atlas.Position) (PasteResult, bool, error) {
	ext := strings.ToLower(filepath.Ext(candidate))
	if !atlas.IsImageExtension(ext) {
		return PasteResult{}, false, nil
	}
	info, statErr := os.Stat(candidate)
	if statErr != nil || info.IsDir() {
		return PasteResult{}, false, nil
	}
	title := titleFromBase(filepath.Base(candidate))
	mirrorPath, err := a.MirrorImageFromPath(candidate, title)
	if err != nil {
		return PasteResult{}, true, err
	}
	return a.landPastedImage(mirrorPath, title, parentID, pos)
}

// recognizeImageURLPaste handles the URL half. The fetch is a single,
// synchronous GET of the exact address the user just pasted -- user-
// initiated, not phone-home (CLAUDE.md's hard constraint carve-out: a
// user-triggered fetch of a user-supplied address, not Mill calling out
// on its own). A fetch failure or a non-image response is the same
// honest non-match as a nonexistent local path: the paste still lands
// as something via the frontend's own note fallback (goal 0218's
// no-dead-end rule) rather than surfacing a raw network error.
func (a *AtlasService) recognizeImageURLPaste(u *url.URL, raw, parentID string, pos atlas.Position) (PasteResult, bool, error) {
	ext := strings.ToLower(path.Ext(u.Path))
	if !atlas.IsImageExtension(ext) {
		return PasteResult{}, false, nil
	}
	data, fetchErr := a.imageURLFetcher(raw)
	if fetchErr != nil {
		return PasteResult{}, false, nil
	}
	title := titleFromBase(path.Base(u.Path))
	mirrorPath, err := a.SaveImageBytes(base64.StdEncoding.EncodeToString(data), ext, title)
	if err != nil {
		return PasteResult{}, true, err
	}
	return a.landPastedImage(mirrorPath, title, parentID, pos)
}

// landPastedImage is the one place both branches above create the
// board object, through CreateBoardObject's own kind="image" shape --
// the exact same door useAtlasImageObjectCreate.ts's native-drop path
// calls after its own MirrorImageFromPath.
func (a *AtlasService) landPastedImage(mirrorPath, title, parentID string, pos atlas.Position) (PasteResult, bool, error) {
	if _, err := a.CreateBoardObject("image", map[string]string{"mirrorPath": mirrorPath, "title": title}, pos, parentID); err != nil {
		return PasteResult{}, true, err
	}
	return PasteResult{Recognized: true, Images: 1}, true, nil
}

// titleFromBase strips a file/URL basename's own extension -- the Go
// twin of atlasCreateHelpers.ts's titleFromFilename, kept this small
// rather than pulled in as a shared cross-language helper since both
// sides already carry their own extension-stripping utility for their
// own filenames (SaveImageBytes's own seeding.NewSlugID call is a
// distinct, unrelated concern -- a fresh ID, not a display title).
func titleFromBase(base string) string {
	return strings.TrimSuffix(base, filepath.Ext(base))
}

// imageURLFetchTimeout bounds the paste door's URL fetch -- a paste is
// a synchronous user gesture waiting on this call, so it fails fast
// rather than hanging the paste on a slow or unresponsive host.
const imageURLFetchTimeout = 10 * time.Second

// fetchImageURLBytes is imageURLFetcher's real, production
// implementation (see the field's own doc comment on AtlasService for
// why the field exists at all) -- a single bounded GET, capped at
// fileread.MaxBytes so a pasted URL can't pull down an unbounded
// response, and content-type checked so a URL that merely LOOKS like
// an image by its path extension (an error page served at a stale
// link, say) is caught before its bytes ever reach the filesystem.
func fetchImageURLBytes(rawURL string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(context.Background(), imageURLFetchTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, fmt.Errorf("atlas image paste: building request: %w", err)
	}
	resp, err := http.DefaultClient.Do(req) //nolint:gosec // rawURL is exactly the address the user pasted onto the board, not a derived or redirected target
	if err != nil {
		return nil, fmt.Errorf("atlas image paste: fetch: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("atlas image paste: fetch %s: status %d", rawURL, resp.StatusCode)
	}
	if ct := resp.Header.Get("Content-Type"); ct != "" && !strings.HasPrefix(ct, "image/") {
		return nil, fmt.Errorf("atlas image paste: %s did not return image content (content-type %q)", rawURL, ct)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, fileread.MaxBytes+1))
	if err != nil {
		return nil, fmt.Errorf("atlas image paste: reading response: %w", err)
	}
	if len(data) > fileread.MaxBytes {
		return nil, fmt.Errorf("atlas image paste: %s is over the %d byte limit", rawURL, fileread.MaxBytes)
	}
	return data, nil
}
