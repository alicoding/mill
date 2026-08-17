package atlassvc

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/alicoding/mill/internal/adapters/markdown"
	"github.com/alicoding/mill/internal/domain/atlas"
	"github.com/alicoding/mill/internal/services/dataevent"
	"github.com/alicoding/mill/internal/services/seeding"
	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

// This file is the capture-doors slice (goal 0081 slice A3, LOCKED
// design §3b): the instant single-file landing a native OS drop or a
// copied-file paste triggers, its card-foremost linked-sibling
// counterpart (D5), the routing decision between instant-landing and
// the existing folder-import preview, and the HTML->Markdown paste
// conversion door.
//
// fileDropProseKindID/fileDropReferenceKindID/fileDropRelatesToLinkKindID
// are literal copies of internal/domain/atlas's own seeded prose/
// reference Kind IDs and its generic association LinkKind ID -- the
// same sanctioned seed-to-seed wiring internal/domain/composition/
// builtinworkflows_atlascard.go already carries for its own copy of
// the Intake Kind ID, since an extension-driven landing door has to
// name an actual Kind deterministically (no popover asks).
// resolveDropKindLocked/resolveRelatesToLinkKindLocked fall back
// gracefully to whatever Kind/LinkKind IS present when the seeded one
// has been deleted or renamed, rather than failing the drop outright.
const (
	fileDropProseKindID         = "atlas-kind-document"
	fileDropReferenceKindID     = "atlas-kind-reference"
	fileDropRelatesToLinkKindID = "atlas-linkkind-relates-to"
)

// FileDropEventName is the Wails event a native OS file drop (macOS/
// Linux drag-and-drop, main.go's OnWindowEvent(events.Common.
// WindowFilesDropped, ...) handler) is relayed to the frontend under --
// mirrors dataevent.EventName's own "one exported wire-name constant"
// convention. Listened for in frontend/src/atlas/useAtlasNativeFileDrop.ts
// via Events.On.
const FileDropEventName = "atlas-native-file-drop"

// FileDropContextBoard/FileDropContextCardPage are the two values the
// dropped-on element's own data-file-drop-context attribute carries
// (AtlasBoard.tsx's wrapper, AtlasCardOverlay.tsx's body) -- main.go's
// window-event handler forwards whichever one matched back to the
// frontend unchanged, so routing never depends on fragile client-side
// "is a dialog currently open" state guessed independently of where the
// OS actually delivered the drop.
const (
	FileDropContextBoard    = "board"
	FileDropContextCardPage = "card-page"
)

// FileDropPayload is FileDropEventName's own wire payload.
type FileDropPayload struct {
	Filenames []string `json:"filenames"`
	X         int      `json:"x"`
	Y         int      `json:"y"`
	Context   string   `json:"context"`
}

// FileDropRoute is ResolveFileDropRoute's own verdict.
type FileDropRoute struct {
	// Kind is "instant" (a single, non-directory file -- land it now,
	// no popover) or "import" (2+ paths, or a single directory -- route
	// into the existing folder-import preview, LOCKED design §3b).
	Kind string
	// Path is, for "instant", the one file path (== paths[0]); for
	// "import", the scan root ImportFolderSuggestions' own preview
	// should open against -- the dropped directory itself for a single
	// directory drop, or the deepest common ancestor of every dropped
	// path for a multi-file drop (dropping several files from the same
	// Finder window is the common case this covers).
	Path string
}

// ResolveFileDropRoute decides what a drop/paste of paths means --
// stats them (never lists a directory's contents; that's ScanFolder's
// own job once the caller acts on an "import" route) so the frontend
// never has to guess file-vs-directory itself. paths must be non-empty.
func (a *AtlasService) ResolveFileDropRoute(paths []string) (FileDropRoute, error) {
	if len(paths) == 0 {
		return FileDropRoute{}, fmt.Errorf("no paths to resolve")
	}
	if len(paths) == 1 {
		info, err := os.Stat(paths[0])
		if err != nil {
			return FileDropRoute{}, fmt.Errorf("stat %q: %w", paths[0], err)
		}
		if info.IsDir() {
			return FileDropRoute{Kind: "import", Path: paths[0]}, nil
		}
		return FileDropRoute{Kind: "instant", Path: paths[0]}, nil
	}
	return FileDropRoute{Kind: "import", Path: commonAncestorDir(paths)}, nil
}

// commonAncestorDir returns the deepest directory that contains every
// one of paths -- each path's own parent directory when they already
// share one (the overwhelming common case: a multi-select drag from one
// Finder window), walking upward from the first path's parent
// otherwise. Pure string/path work, no filesystem access.
func commonAncestorDir(paths []string) string {
	root := filepath.Dir(paths[0])
	for _, p := range paths[1:] {
		dir := filepath.Dir(p)
		for !pathIsAncestorOrSelf(root, dir) && root != string(filepath.Separator) && root != "." {
			root = filepath.Dir(root)
		}
	}
	return root
}

func pathIsAncestorOrSelf(ancestor, path string) bool {
	ancestor, path = filepath.Clean(ancestor), filepath.Clean(path)
	if ancestor == path {
		return true
	}
	rel, err := filepath.Rel(ancestor, path)
	if err != nil {
		return false
	}
	return rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator))
}

// resolveDropKindLocked maps path's extension to the seeded Kind ID the
// LOCKED design names, falling back to whichever Kind IS present (the
// first declared one) when the seeded target has been deleted/renamed
// -- a dropped file must never be refused just because its seeded
// destination Kind is gone. Caller must hold a.mu (read lock suffices).
func (a *AtlasService) resolveDropKindLocked(path string) string {
	want := fileDropReferenceKindID
	if atlas.ClassifyDropPath(path) == atlas.DropCategoryProse {
		want = fileDropProseKindID
	}
	if a.findKindLocked(want) != -1 {
		return want
	}
	if len(a.kinds) > 0 {
		return a.kinds[0].ID
	}
	return ""
}

// resolveRelatesToLinkKindLocked is resolveDropKindLocked's own
// counterpart for D5's linked-sibling link -- same graceful-fallback
// shape. Caller must hold a.mu.
func (a *AtlasService) resolveRelatesToLinkKindLocked() string {
	if a.findLinkKindLocked(fileDropRelatesToLinkKindID) != -1 {
		return fileDropRelatesToLinkKindID
	}
	if len(a.linkKinds) > 0 {
		return a.linkKinds[0].ID
	}
	return ""
}

// CreateCardFromFileDrop is the instant single-file landing door
// (LOCKED design §3b): kind derived from path's extension, MirrorPath
// set to path itself (mirror-only, decision 4 -- the map never copies
// file content into its own ownership), no popover. title/parentID/
// position are the frontend's own resolved values (title from the
// filename, parent from the drop context's frame/zoomed area, position
// from the drop point) -- this method only resolves the one piece of
// seeded-concept knowledge (which Kind) that must never live in
// frontend source (atlasNoHardcode.test.ts).
func (a *AtlasService) CreateCardFromFileDrop(path, title, parentID string, position *atlas.Position) (atlas.Card, error) {
	a.mu.Lock()
	kindID := a.resolveDropKindLocked(path)
	a.mu.Unlock()
	if kindID == "" {
		return atlas.Card{}, fmt.Errorf("no kind declared to land a dropped file as")
	}
	return a.createCardWithID(seeding.NewSlugID(title, "card"), kindID, title, "", nil, parentID, position, "", "", path, "", "")
}

// CreateLinkedFileCard is card-foremost file drop (D5, LOCKED design):
// while a card's page is open, a dropped file becomes a LINKED SIBLING
// -- same parent as the open card, plus the generic association link
// kind (resolveRelatesToLinkKindLocked) from the open card to the new
// one -- atomically: the card and the link either both persist or
// neither does, so the open card's own links section is never observed
// in a half-written state. The open card itself is never mutated.
func (a *AtlasService) CreateLinkedFileCard(openCardID, path, title string, position *atlas.Position) (atlas.Card, error) {
	a.mu.Lock()
	openIdx := a.findCardLocked(openCardID)
	if openIdx == -1 {
		a.mu.Unlock()
		return atlas.Card{}, fmt.Errorf("no card with id %q", openCardID)
	}
	parentID := a.cards[openIdx].ParentID
	kindID := a.resolveDropKindLocked(path)
	if kindID == "" {
		a.mu.Unlock()
		return atlas.Card{}, fmt.Errorf("no kind declared to land a dropped file as")
	}
	kind, err := a.resolveKindLocked(kindID)
	if err != nil {
		a.mu.Unlock()
		return atlas.Card{}, err
	}
	linkKindID := a.resolveRelatesToLinkKindLocked()
	if linkKindID == "" {
		a.mu.Unlock()
		return atlas.Card{}, fmt.Errorf("no link kind declared to link a dropped file with")
	}

	now := time.Now()
	card := atlas.Card{
		ID: seeding.NewSlugID(title, "card"), KindID: kindID, Title: title,
		ParentID: parentID, Position: position, MirrorPath: path,
		CreatedAt: now, UpdatedAt: now,
	}
	if err := atlas.ValidateCard(card, kind); err != nil {
		a.mu.Unlock()
		return atlas.Card{}, err
	}
	link := atlas.Link{
		ID: seeding.NewSlugID(title, "link"), FromCardID: openCardID, ToCardID: card.ID,
		LinkKindID: linkKindID, CreatedAt: now, UpdatedAt: now,
	}
	if err := atlas.ValidateLink(link); err != nil {
		a.mu.Unlock()
		return atlas.Card{}, err
	}

	a.cards = append(a.cards, card)
	a.links = append(a.links, link)
	perr := a.persistLocked()
	if perr != nil {
		a.links = a.links[:len(a.links)-1]
		a.cards = a.cards[:len(a.cards)-1]
	}
	a.mu.Unlock()
	if perr != nil {
		return atlas.Card{}, fmt.Errorf("save linked file card: %w", perr)
	}
	dataevent.Emit("atlas", card.ID)
	a.notifyCardChange(card, "create", "")
	return card, nil
}

// ConvertHTMLToMarkdown is the paste door's own HTML branch (LOCKED
// design §2b/§3b): clipboard HTML converts to Markdown through the
// exact same domain function process-html-to-markdown's workflow node
// already runs (internal/adapters/markdown.ToMarkdown) before the
// placement popover ever opens -- never a second, JS-side converter.
func (a *AtlasService) ConvertHTMLToMarkdown(html string) (string, error) {
	return markdown.ToMarkdown(html)
}

// WireFileDropWindow relays window's own native OS file-drop events
// (main.go's EnableFileDrop) to the frontend as FileDropEventName --
// main.go's only call into this file, right after the window itself is
// constructed. Not a frontend RPC: this takes a *application.WebviewWindow,
// which Wails' binding generator can't marshal.
//
//wails:ignore
func (a *AtlasService) WireFileDropWindow(window *application.WebviewWindow) {
	window.OnWindowEvent(events.Common.WindowFilesDropped, func(e *application.WindowEvent) {
		ctx := e.Context()
		filenames := ctx.DroppedFiles()
		if len(filenames) == 0 {
			return
		}
		payload := FileDropPayload{Filenames: filenames}
		if details := ctx.DropTargetDetails(); details != nil {
			payload.X, payload.Y = details.X, details.Y
			if details.Attributes != nil {
				payload.Context = details.Attributes["data-file-drop-context"]
			}
		}
		if app := application.Get(); app != nil {
			app.Event.Emit(FileDropEventName, payload)
		}
	})
}
