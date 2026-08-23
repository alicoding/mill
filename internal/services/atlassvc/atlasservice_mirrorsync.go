package atlassvc

import (
	"fmt"

	"github.com/alicoding/mill/internal/domain/atlas"
)

// This file is the shared mirror-sync primitive (goal 0178 S1): the
// merge-or-create decision atlasservice_ledgersync.go's syncOneLedgerDoc
// already proved (an existing card at a file's own MirrorPath is
// refreshed in place, a checksum-unchanged file is a pure no-op, and a
// new path becomes a new card), generalized so
// atlasservice_folderimport.go's ImportFolderSuggestions can reuse the
// exact same identity/merge rule instead of unconditionally creating a
// new card on every call -- which is what made a re-import duplicate
// every file it had already imported.

// mirrorSyncEntry is one candidate file OR container to mirror as a
// card, keyed by its own MirrorPath (goal 0178 S2 gives a container
// entry a real MirrorPath too, its own source folder -- see
// ImportFolderSuggestions' own doc comment for why this is what makes
// nested reimport idempotent). A container entry's Checksum stays ""
// (a directory has no content hash) and Fields stays nil, so
// createMirrorCard/refreshMirrorCard below never touch either for it.
type mirrorSyncEntry struct {
	MirrorPath string
	// Checksum is the file's current content hash. Empty means either
	// "not a file" or "unreadable right now" -- either way, an existing
	// card at MirrorPath is never treated as unchanged purely on an
	// empty checksum (that would require a real match), and its stored
	// checksum is left untouched rather than overwritten with "".
	Checksum  string
	NewCardID string
	KindID    string
	Title     string
	ParentID  string
	Position  *atlas.Position
	ViewMode  atlas.ViewMode
	// Fields carries this entry's own Kind-coerced frontmatter -- nil
	// for a directory, or a file whose header didn't parse. Merged onto
	// an existing card via MergeCardFields (a Kind field absent from
	// this map is never touched, so an owner-owned value survives every
	// re-sync by construction -- goal 0172 S1) or set directly at
	// create time.
	Fields map[string]string
	// ExtraCreateFields are stamped ONLY when a brand-new card is
	// created (the ledger sync's own pending-verify signoff default) --
	// never applied to an existing card's refresh, which would silently
	// overwrite a real value the source file never carries.
	ExtraCreateFields map[string]string
	SourceRunID       string
}

// syncMirrorCard resolves one mirrorSyncEntry against byMirror: a file
// whose checksum still matches its existing card is a pure no-op;
// anything else existing goes through refreshMirrorCard; anything
// absent from byMirror goes through createMirrorCard. Shared by
// SyncLedgerFolder (the ledger's own re-sync, the ORIGINAL and
// still-only-ledger-owned behaviour this must reproduce exactly) and
// ImportFolderSuggestions (goal 0178 S1).
func (a *AtlasService) syncMirrorCard(e mirrorSyncEntry, byMirror map[string]atlas.Card) (id string, created, refreshed bool, err error) {
	existing, hasExisting := byMirror[e.MirrorPath]
	if hasExisting && e.Checksum != "" && existing.MirrorChecksum == e.Checksum {
		return existing.ID, false, false, nil
	}
	if hasExisting {
		if err := a.refreshMirrorCard(e, existing); err != nil {
			return "", false, false, err
		}
		return existing.ID, false, true, nil
	}
	card, err := a.createMirrorCard(e)
	if err != nil {
		return "", false, false, err
	}
	return card.ID, true, false, nil
}

// refreshMirrorCard applies one mirrorSyncEntry's checksum/Fields onto
// an already-existing card -- the "content changed" half of
// syncMirrorCard's merge-or-create decision. Fields nil skips the
// merge entirely, matching an unparseable/no-frontmatter file. A
// directory entry (empty Checksum, nil Fields -- goal 0178 S2) still
// reaches the stampSynced call below on every pass, since it never
// takes syncMirrorCard's own checksum-match shortcut: this is what
// keeps a mirrored container's own freshness honest across repeated
// syncs even though it has no content checksum of its own.
func (a *AtlasService) refreshMirrorCard(e mirrorSyncEntry, existing atlas.Card) error {
	if e.Checksum != "" {
		if err := a.setMirrorChecksum(existing.ID, e.Checksum); err != nil {
			return fmt.Errorf("sync mirror card: refresh %q: %w", existing.Title, err)
		}
	}
	if e.Fields != nil {
		if _, err := a.MergeCardFields(existing.ID, e.Fields, e.SourceRunID); err != nil {
			return fmt.Errorf("sync mirror card: merge fields for %q: %w", existing.Title, err)
		}
	}
	if _, err := a.stampSynced(existing.ID); err != nil {
		return fmt.Errorf("sync mirror card: stamp synced for %q: %w", existing.Title, err)
	}
	return nil
}

// createMirrorCard creates a brand-new card for one mirrorSyncEntry --
// the "no existing card at this MirrorPath" half of syncMirrorCard's
// merge-or-create decision. ExtraCreateFields (the ledger's own
// pending-verify signoff default) apply ONLY here, never to a refresh,
// which would silently overwrite a real value the source never carries.
func (a *AtlasService) createMirrorCard(e mirrorSyncEntry) (atlas.Card, error) {
	fields := e.Fields
	if len(e.ExtraCreateFields) > 0 {
		merged := make(map[string]string, len(fields)+len(e.ExtraCreateFields))
		for k, v := range fields {
			merged[k] = v
		}
		for k, v := range e.ExtraCreateFields {
			merged[k] = v
		}
		fields = merged
	}
	card, err := a.createCardWithID(e.NewCardID, e.KindID, e.Title, "", fields, e.ParentID, e.Position, e.ViewMode, "", e.MirrorPath, e.Checksum, "", e.SourceRunID)
	if err != nil {
		return atlas.Card{}, fmt.Errorf("sync mirror card: create for %q: %w", e.Title, err)
	}
	synced, err := a.stampSynced(card.ID)
	if err != nil {
		return atlas.Card{}, fmt.Errorf("sync mirror card: stamp synced for %q: %w", e.Title, err)
	}
	return synced, nil
}

// mirrorIndexLocked returns every live card that carries a MirrorPath,
// keyed by that path. Caller must hold a.mu (a read lock suffices).
func (a *AtlasService) mirrorIndexLocked() map[string]atlas.Card {
	byMirror := map[string]atlas.Card{}
	for _, c := range a.liveCardsLocked() {
		if c.MirrorPath != "" {
			byMirror[c.MirrorPath] = c
		}
	}
	return byMirror
}

// mirrorIndex locks and returns mirrorIndexLocked's own result --
// ImportFolderSuggestions' entry point, which unlike SyncLedgerFolder
// doesn't already hold a.mu at the point it needs this index.
func (a *AtlasService) mirrorIndex() map[string]atlas.Card {
	a.mu.RLock()
	defer a.mu.RUnlock()
	return a.mirrorIndexLocked()
}
