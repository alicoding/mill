package atlassvc

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"path/filepath"
	"strings"

	"github.com/alicoding/mill/internal/domain/atlas"
)

// A workflow's own downloaded-file door (goal 0350 S3): re-running a
// browser-replay flow that downloads the same content must match, not
// duplicate, so a run can honestly answer "when did this first land".
// Bytes already crossed the bridge by the time this runs
// (composition.execAtlasFileObject decoded them out of the browser-
// replay payload) -- this file only resolves which board-object Kind
// can render them, writes them under the captures dir through
// SaveFileBytes, and checks whether the SAME content already landed.

// downloadKindByExtension maps a downloaded file's extension to the
// board-object Kind Mill already ships a renderer for. An extension
// matching none of these -- image extensions are checked separately,
// via atlas.IsImageExtension -- is a real, tracked gap (a generic
// file-object Kind/renderer; no such Kind exists in
// atlas.BuiltInBoardObjectKinds today) rather than a silent guess:
// handing pdf.js or the sheet grid bytes neither can read would be
// worse than not creating an object at all.
var downloadKindByExtension = map[string]string{
	".pdf": "pdf", ".csv": "sheet", ".xlsx": "sheet",
	".json": "json", ".drawio": "diagram", ".mmd": "diagram", ".mermaid": "diagram",
}

// downloadBoardObjectKind resolves filename's extension to the Kind a
// download becomes, ok false when Mill has no renderer for it yet.
func downloadBoardObjectKind(filename string) (kind string, ok bool) {
	ext := strings.ToLower(filepath.Ext(filename))
	if atlas.IsImageExtension(ext) {
		return "image", true
	}
	kind, ok = downloadKindByExtension[ext]
	return kind, ok
}

// defaultDownloadObjectPosition is where a download-created object
// lands when nothing placed it -- the same near-origin point
// atlas_create_board_object (mcpsvc's own MCP door) uses, for the
// identical reason: this door runs inside a workflow step, with no
// live viewport or rendered-footprint search to place it against.
var defaultDownloadObjectPosition = atlas.Position{X: 80, Y: 80}

// downloadObjectDateFormat is how a duplicate download's "already on
// the board" sentence renders its timestamp -- local time, matching
// apply-file-write's own stamp-line convention (applyfilewrite.go's
// timestampStampFormat).
const downloadObjectDateFormat = "2006-01-02 15:04"

// FileObjectResult is what landing (or matching) one downloaded file
// as a board object reports back to the apply step that asked.
type FileObjectResult struct {
	// ObjectID is empty when Mill could not place the download at all
	// (no Kind resolved for its extension).
	ObjectID string
	// Note is set whenever the run should hear something beyond "it
	// landed": a duplicate match (names the run and time it first
	// landed), or an unresolvable Kind.
	Note string
}

// CreateFileObjectFromDownload lands base64Data as a file-backed board
// object, or -- when the same content already landed -- reports that
// existing object unchanged, never a duplicate. filename is the
// browser's own download name (the object's title and
// its file extension both read from it); sourceRunID is the writing
// run's own id, stamped onto a NEW object's Payload so a later
// duplicate hit can name which run first landed it.
func (a *AtlasService) CreateFileObjectFromDownload(base64Data, filename, sourceRunID string) (FileObjectResult, error) {
	kind, ok := downloadBoardObjectKind(filename)
	if !ok {
		return FileObjectResult{Note: fmt.Sprintf("Mill can't show %q's file type on the board yet. It's saved, but not placed.", filename)}, nil
	}

	raw, err := base64.StdEncoding.DecodeString(base64Data)
	if err != nil {
		return FileObjectResult{}, fmt.Errorf("atlas file object: decode: %w", err)
	}
	checksum := sha256Hex(raw)

	if existing, found := a.findFileObjectByChecksum(checksum); found {
		return FileObjectResult{ObjectID: existing.ID, Note: duplicateFileObjectNote(existing)}, nil
	}

	title := titleFromBase(filename)
	path, err := a.SaveFileBytes(base64Data, filepath.Ext(filename), title)
	if err != nil {
		return FileObjectResult{}, fmt.Errorf("atlas file object: %w", err)
	}
	payload := map[string]string{
		"mirrorPath": path, "mirrorName": filename, "mirrorChecksum": checksum,
		"title": title, "sourceRunId": sourceRunID,
	}
	o, err := a.CreateBoardObject(kind, payload, defaultDownloadObjectPosition, "")
	if err != nil {
		return FileObjectResult{}, fmt.Errorf("atlas file object: %w", err)
	}
	return FileObjectResult{ObjectID: o.ID}, nil
}

// findFileObjectByChecksum is a narrow payload-scan over live board
// objects -- never the card checksum index (atlaschecksum.go's
// checksumIndexLocked), which is card-only. A workflow lands at most a
// handful of downloads per run, so an O(n) scan of the board's own
// object count costs nothing a real index would meaningfully save, and
// a second index kept in sync with every Payload write is maintenance
// this scale doesn't justify.
func (a *AtlasService) findFileObjectByChecksum(checksum string) (atlas.BoardObject, bool) {
	a.mu.RLock()
	defer a.mu.RUnlock()
	for _, o := range a.objects {
		if !o.DeletedAt.IsZero() {
			continue
		}
		if o.Payload["mirrorChecksum"] == checksum {
			return o, true
		}
	}
	return atlas.BoardObject{}, false
}

// duplicateFileObjectNote names when a duplicate first landed, and
// which run brought it -- sourceRunId is absent on an object created
// before this field existed, or one placed by hand rather than a run.
func duplicateFileObjectNote(o atlas.BoardObject) string {
	when := o.CreatedAt.Format(downloadObjectDateFormat)
	if runID := o.Payload["sourceRunId"]; runID != "" {
		return fmt.Sprintf("Already on the board since run %s (%s).", runID, when)
	}
	return fmt.Sprintf("Already on the board since %s.", when)
}

func sha256Hex(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}
