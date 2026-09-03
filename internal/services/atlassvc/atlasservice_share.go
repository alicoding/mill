package atlassvc

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/alicoding/mill/internal/adapters/osopen"
	"github.com/alicoding/mill/internal/adapters/windowing"
)

// This file is Atlas's share model (docs/adr/0038, goal 0063): turning
// a card or a space into something a human or an AI assistant can
// actually consume outside Mill -- a paste-ready text block, a cloud
// link, or a real folder on disk. Rendering lives here (atlassvc)
// rather than in internal/domain/atlas so the golden test proving its
// output pins the SAME text a frontend Copy button and any future MCP
// surface both produce, from one place.
//
// v1's "with attachments" toggle only ever lists a card's MirrorPath
// as a file reference inside the text block -- it never embeds file
// CONTENT. Reading and inlining arbitrary mirrored file bytes into a
// text block is real scope (binary detection, size limits, a second
// content-type-aware renderer) deliberately left for a later goal.

// cardLinkRef is one link from cardLinksLocked's point of view: the
// OTHER card's title and the LinkKind's own label, direction already
// resolved.
type cardLinkRef struct {
	linkKindLabel string
	otherTitle    string
}

// renderedField is one of a card's Fields, already resolved to its
// kind's declared label -- renderCardContext's own input shape, kept
// unexported since nothing outside this file needs a card's context
// block broken into pieces.
type renderedField struct {
	label string
	value string
}

// cardContextInput is everything renderCardContext needs, already
// resolved from a.kinds/a.cards/a.links -- separated from the
// service's locked state so the renderer itself stays a pure function
// a test can call directly with a literal fixture, no AtlasService
// required.
type cardContextInput struct {
	title      string
	kindLabel  string
	fields     []renderedField
	note       string
	outgoing   []cardLinkRef
	incoming   []cardLinkRef
	source     string
	mirrorPath string
}

// cardLinksLocked splits every link touching cardID into outgoing
// (cardID is FromCardID) and incoming (cardID is ToCardID), each in
// a.links' own stored order -- deterministic by construction, the same
// "already-stored data in stable slice order" guarantee ExportAtlas's
// own doc comment relies on. Caller must hold a.mu.
func (a *AtlasService) cardLinksLocked(cardID string) (outgoing, incoming []cardLinkRef) {
	linkKindByID := make(map[string]string, len(a.linkKinds))
	for _, lk := range a.linkKinds {
		linkKindByID[lk.ID] = lk.Label
	}
	cardTitleByID := make(map[string]string, len(a.cards))
	for _, c := range a.liveCardsLocked() {
		cardTitleByID[c.ID] = c.Title
	}
	for _, l := range a.liveLinksLocked() {
		if l.FromCardID == cardID {
			outgoing = append(outgoing, cardLinkRef{linkKindLabel: linkKindByID[l.LinkKindID], otherTitle: cardTitleByID[l.ToCardID]})
		}
		if l.ToCardID == cardID {
			incoming = append(incoming, cardLinkRef{linkKindLabel: linkKindByID[l.LinkKindID], otherTitle: cardTitleByID[l.FromCardID]})
		}
	}
	return outgoing, incoming
}

// cardContextInputLocked resolves cardID's own context-block input --
// the kind's Label plus every declared field in the KIND's own order
// (never Go map order, which is randomized), the note, its links, and
// its source/mirror attributes. Caller must hold a.mu.
func (a *AtlasService) cardContextInputLocked(cardID string) (cardContextInput, error) {
	idx := a.findCardLocked(cardID)
	if idx == -1 {
		return cardContextInput{}, fmt.Errorf("no card with id %q", cardID)
	}
	card := a.cards[idx]
	kind, err := a.resolveKindLocked(card.KindID)
	if err != nil {
		return cardContextInput{}, err
	}
	fields := make([]renderedField, 0, len(kind.Fields))
	for _, f := range kind.Fields {
		if v, ok := card.Fields[f.Key]; ok && v != "" {
			fields = append(fields, renderedField{label: f.Label, value: v})
		}
	}
	outgoing, incoming := a.cardLinksLocked(cardID)
	return cardContextInput{
		title: card.Title, kindLabel: kind.Label, fields: fields, note: card.Note,
		outgoing: outgoing, incoming: incoming, source: card.Source, mirrorPath: card.MirrorPath,
	}, nil
}

// renderCardContext is the pure text renderer behind CardContextBlock
// -- title, kind, every declared field that actually has a value (in
// the kind's own declared order, never map order), the note, links
// (outgoing then incoming, each "kind label -> other title"), the
// source URL, and (withAttachments only) the mirrored file's path.
// Deterministic: the same input always produces the same bytes, the
// property atlasservice_share_test.go's golden fixtures pin.
func renderCardContext(in cardContextInput, withAttachments bool) string {
	var b strings.Builder
	b.WriteString(in.title)
	b.WriteString("\n")
	fmt.Fprintf(&b, "Kind: %s\n", in.kindLabel)
	for _, f := range in.fields {
		fmt.Fprintf(&b, "%s: %s\n", f.label, f.value)
	}
	if in.note != "" {
		fmt.Fprintf(&b, "\n%s\n", in.note)
	}
	if len(in.outgoing) > 0 || len(in.incoming) > 0 {
		b.WriteString("\nLinks:\n")
		for _, l := range in.outgoing {
			fmt.Fprintf(&b, "- %s → %s\n", l.linkKindLabel, l.otherTitle)
		}
		for _, l := range in.incoming {
			fmt.Fprintf(&b, "- %s ← %s\n", l.linkKindLabel, l.otherTitle)
		}
	}
	if in.source != "" {
		fmt.Fprintf(&b, "\nSource: %s\n", in.source)
	}
	if withAttachments && in.mirrorPath != "" {
		fmt.Fprintf(&b, "Attachment: %s\n", in.mirrorPath)
	}
	return strings.TrimRight(b.String(), "\n")
}

// cardContextBlockLocked is CardContextBlock's own logic, callable
// while a.mu is already held -- SpaceBundleContext's own loop needs
// this (sync.RWMutex.RLock is not safely reentrant), so the exported
// method below is a thin RLock wrapper around it, never the other way
// round.
func (a *AtlasService) cardContextBlockLocked(cardID string, withAttachments bool) (string, error) {
	in, err := a.cardContextInputLocked(cardID)
	if err != nil {
		return "", err
	}
	return renderCardContext(in, withAttachments), nil
}

// CardContextBlock renders cardID's fields/note/links as one stable,
// paste-ready text block (goal 0063's copy-as-context) -- the Card
// overlay/chip's "Copy as context" action copies exactly this string.
func (a *AtlasService) CardContextBlock(cardID string, withAttachments bool) (string, error) {
	a.mu.RLock()
	defer a.mu.RUnlock()
	return a.cardContextBlockLocked(cardID, withAttachments)
}

// SpaceBundleContext concatenates spaceID's own children's context
// blocks, each separated by a divider line -- the space toolbar's
// "Bundle as context" action, one paste covering everything currently
// in the viewed space (goal 0063). spaceID == "" names the true root
// (every card whose ParentID is "").
func (a *AtlasService) SpaceBundleContext(spaceID string, withAttachments bool) (string, error) {
	a.mu.RLock()
	defer a.mu.RUnlock()
	if spaceID != "" && a.findCardLocked(spaceID) == -1 {
		return "", fmt.Errorf("no card with id %q", spaceID)
	}
	var blocks []string
	for _, c := range a.liveCardsLocked() {
		if c.ParentID != spaceID {
			continue
		}
		block, err := a.cardContextBlockLocked(c.ID, withAttachments)
		if err != nil {
			return "", err
		}
		blocks = append(blocks, block)
	}
	return strings.Join(blocks, "\n\n---\n\n"), nil
}

// SpaceLinksList lists every Source URL set on spaceID's own children,
// one per line, in a.cards' own stored order -- the space toolbar's
// "Copy links" action.
func (a *AtlasService) SpaceLinksList(spaceID string) (string, error) {
	a.mu.RLock()
	defer a.mu.RUnlock()
	if spaceID != "" && a.findCardLocked(spaceID) == -1 {
		return "", fmt.Errorf("no card with id %q", spaceID)
	}
	var urls []string
	for _, c := range a.liveCardsLocked() {
		if c.ParentID != spaceID || c.Source == "" {
			continue
		}
		urls = append(urls, c.Source)
	}
	return strings.Join(urls, "\n"), nil
}

// --- mirror folders + reveal ---

// SetMirrorsDir wires the Mill-owned root directory space mirror
// folders are created under -- main.go's own MILL_ATLAS_MIRRORS_DIR-
// or-default call, the same late-bound-setter shape as
// BackupService.New's dir parameter, but a setter rather than a
// constructor parameter since AtlasService already has many callers
// (tests included) that have no reason to know about it.
//
//wails:ignore
func (a *AtlasService) SetMirrorsDir(dir string) {
	a.mu.Lock()
	a.mirrorsDir = dir
	a.mu.Unlock()
}

// spaceFolderPathLocked returns (creating lazily if needed) spaceID's
// own mirror folder: a.mirrorsDir/<spaceID>. A card's own ID is
// already "human-readable-label-slug + random suffix"
// (seeding.NewSlugID) -- stable and collision-proof on its own, so it
// doubles as the folder name with no separate space->folder mapping to
// persist. spaceID == "" (the true root, which is not itself a card)
// maps to a.mirrorsDir/root. Caller must hold a.mu (a read lock
// suffices; os.MkdirAll is safe under concurrent callers).
func (a *AtlasService) spaceFolderPathLocked(spaceID string) (string, error) {
	if a.mirrorsDir == "" {
		return "", fmt.Errorf("atlas share: no mirrors directory is configured")
	}
	name := spaceID
	if name == "" {
		name = "root"
	}
	dir := filepath.Join(a.mirrorsDir, name)
	if err := os.MkdirAll(dir, 0o750); err != nil {
		return "", fmt.Errorf("create space mirror folder: %w", err)
	}
	return dir, nil
}

// DefaultMirrorsDir resolves the atlas-mirrors root directory: override
// if non-empty (main.go's own MILL_ATLAS_MIRRORS_DIR read), otherwise
// the same mill/<subdir> OS config-home convention every other
// Mill-owned directory (settings, execution db, backups) already uses.
// A plain function, not a method -- called before any AtlasService
// exists yet, same shape backupsvc.SQLiteDBPath takes for its own
// pre-construction path resolution.
func DefaultMirrorsDir(override string) string {
	if override != "" {
		return override
	}
	return filepath.Join(windowing.ConfigHome(), "mill", "atlas-mirrors")
}

// revealPath opens path in the OS file manager -- same
// BackupService.RevealBackupFolder mechanism (Wails3's own
// BrowserManager.OpenURL, which shells out to the platform "open"
// equivalent): a nil application (go test, no live Wails app running)
// is a no-op.
func revealPath(path string) error {
	return osopen.Open("file://" + path)
}

// RevealSpaceFolder lazily creates (if needed) and opens spaceID's own
// mirror folder in the OS file manager, returning its path -- the
// space toolbar's "Reveal folder" action, and the one operation that
// turns the folder into a STANDING reference: reveal once, then drag
// it into any AI assistant that grounds on a folder, permanently.
func (a *AtlasService) RevealSpaceFolder(spaceID string) (string, error) {
	a.mu.Lock()
	if spaceID != "" && a.findCardLocked(spaceID) == -1 {
		a.mu.Unlock()
		return "", fmt.Errorf("no card with id %q", spaceID)
	}
	dir, err := a.spaceFolderPathLocked(spaceID)
	a.mu.Unlock()
	if err != nil {
		return "", err
	}
	if err := revealPath(dir); err != nil {
		return "", err
	}
	return dir, nil
}

// cardMirrorPathLocked resolves cardID's own MirrorPath, or an error
// naming which of "unknown card"/"nothing mirrored yet" applies --
// the shared lookup RevealCardMirror and OpenCardMirror both start
// from.
func (a *AtlasService) cardMirrorPathLocked(cardID string) (string, error) {
	idx := a.findCardLocked(cardID)
	if idx == -1 {
		return "", fmt.Errorf("no card with id %q", cardID)
	}
	path := a.cards[idx].MirrorPath
	if path == "" {
		return "", fmt.Errorf("card %q has no mirrored file", cardID)
	}
	return path, nil
}

// RevealCardMirror selects cardID's own MirrorPath in the OS file
// manager, WITHOUT opening it -- the card menu/overlay's "Reveal in
// file manager" action (goal 0081 slice A4, macOS `open -R`), only
// ever offered once a refresh has actually run and set MirrorPath.
// Distinct from OpenCardMirror below, which launches the file instead
// of selecting it.
func (a *AtlasService) RevealCardMirror(cardID string) error {
	a.mu.RLock()
	path, err := a.cardMirrorPathLocked(cardID)
	a.mu.RUnlock()
	if err != nil {
		return err
	}
	return revealMirrorFile(path)
}

// OpenCardMirror launches cardID's own MirrorPath with the OS default
// application for its file type (goal 0081 slice A4's "Open file"
// card-menu item, macOS `open`) -- distinct from RevealCardMirror,
// which selects the file in the file manager instead of launching it.
func (a *AtlasService) OpenCardMirror(cardID string) error {
	a.mu.RLock()
	path, err := a.cardMirrorPathLocked(cardID)
	a.mu.RUnlock()
	if err != nil {
		return err
	}
	return openMirrorFile(path)
}

// revealMirrorFile/openMirrorFile wrap internal/adapters/osopen with
// the same "no live desktop app, no-op" guard revealPath above already
// establishes -- a headless `go test` run (or server mode without a
// window) must never actually shell out to the real OS file manager.
func revealMirrorFile(path string) error {
	if !windowing.Available() {
		return nil
	}
	return osopen.Reveal(path)
}

func openMirrorFile(path string) error {
	if !windowing.Available() {
		return nil
	}
	return osopen.Open(path)
}
