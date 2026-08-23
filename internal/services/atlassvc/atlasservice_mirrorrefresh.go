package atlassvc

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/alicoding/mill/internal/domain/atlas"
)

// This file is "Refresh from folder" (goal 0178 S2): the honest re-sync
// gesture on an already-imported, mirrored container -- re-scan its own
// MirrorPath and run every entry through the exact same syncMirrorCard
// primitive ImportFolderSuggestions/SyncLedgerFolder already use (goal
// 0178 S1), rather than making the user re-open the folder picker and
// re-choose a Kind for every category again. A source that has
// vanished since the last sync is marked (MirrorMissing), never
// deleted.

// RefreshMirrorContainer re-syncs cardID -- which must already carry a
// MirrorPath from a prior import -- against its own source folder on
// disk. The folder itself having vanished is reported as an error and
// marks the container MirrorMissing; anything ELSE gone missing
// underneath it (a file, a nested folder) is marked the same way but
// never blocks the rest of the refresh from running.
func (a *AtlasService) RefreshMirrorContainer(cardID string) (FolderImportSummary, error) {
	a.mu.RLock()
	idx := a.findCardLocked(cardID)
	if idx == -1 {
		a.mu.RUnlock()
		return FolderImportSummary{}, fmt.Errorf("refresh from folder: no card with id %q", cardID)
	}
	card := a.cards[idx]
	a.mu.RUnlock()
	if card.MirrorPath == "" {
		return FolderImportSummary{}, fmt.Errorf("refresh from folder: %q has no mirrored source folder", card.Title)
	}

	info, statErr := os.Stat(card.MirrorPath)
	if statErr != nil || !info.IsDir() {
		if err := a.markMirrorMissing(card.ID); err != nil {
			return FolderImportSummary{}, err
		}
		return FolderImportSummary{}, fmt.Errorf("refresh from folder: %q no longer exists", card.MirrorPath)
	}

	// Snapshot BEFORE the re-scan/import call below: a file genuinely
	// gone from disk is never listed by that fresh scan, so this is the
	// only place that still has its card id to mark.
	before := a.mirroredDescendantsOf(card.ID)

	scanned, err := a.ScanFolder(card.MirrorPath)
	if err != nil {
		return FolderImportSummary{}, fmt.Errorf("refresh from folder: %w", err)
	}
	accepted := make([]string, 0, len(scanned.Entries))
	for _, e := range scanned.Entries {
		accepted = append(accepted, e.RelPath)
	}
	summary, err := a.ImportFolderSuggestions(ImportFolderSuggestionsRequest{
		Root:             card.MirrorPath,
		TargetParentID:   card.ID,
		AcceptedRelPaths: accepted,
		CategoryKindIDs:  a.inferRefreshCategoryKindIDs(card, before),
	})
	if err != nil {
		return summary, fmt.Errorf("refresh from folder: %w", err)
	}

	if err := a.reconcileVanishedMirrors(card.MirrorPath, scanned.Entries, before); err != nil {
		return summary, err
	}
	// The container itself is never an entry of its own scan (entries
	// are relative to it), so its own freshness/missing state is
	// stamped explicitly here rather than falling out of syncMirrorCard.
	if _, err := a.stampSynced(card.ID); err != nil {
		return summary, err
	}
	return summary, nil
}

// mirroredDescendantsOf returns every LIVE card in containerID's own
// containment subtree (any depth) that carries a MirrorPath --
// RefreshMirrorContainer's "what did we already know about" snapshot,
// and inferRefreshCategoryKindIDs' own learning set. Scoped by
// containment (atlas.DescendantsAndSelf), never by path, so a
// cross-space duplicate import (goal 0088) sharing the same folder
// elsewhere in the atlas is never swept into this container's refresh.
func (a *AtlasService) mirroredDescendantsOf(containerID string) []atlas.Card {
	a.mu.RLock()
	defer a.mu.RUnlock()
	byID := make(map[string]atlas.Card, len(a.cards))
	for _, c := range a.liveCardsLocked() {
		byID[c.ID] = c
	}
	descendants := atlas.DescendantsAndSelf(byID, containerID)
	out := make([]atlas.Card, 0, len(descendants))
	for id := range descendants {
		if id == containerID {
			continue
		}
		if c, ok := byID[id]; ok && c.MirrorPath != "" {
			out = append(out, c)
		}
	}
	return out
}

// inferRefreshCategoryKindIDs picks one Kind per ScanCategory for a
// refresh's own re-scan, learned from cards ALREADY synced under this
// container rather than asked of the user again -- the whole point of
// "refresh" over "re-run the import picker". A category with no
// existing precedent among descendants falls back to whichever
// precedent DOES exist, and a container with no mirrored descendants
// at all (nothing to learn from -- an empty or fully-vanished folder)
// falls back to its own Kind for every category, so a brand-new file
// type dropped into an already-imported folder still gets created
// instead of hard-failing the whole refresh; the user can always
// recategorize it afterward, or use the full Add-from-folder flow for
// finer per-entry control.
func (a *AtlasService) inferRefreshCategoryKindIDs(container atlas.Card, descendants []atlas.Card) map[string]string {
	byCategory := map[atlas.ScanCategory]string{}
	for _, c := range descendants {
		if c.KindID == "" {
			continue
		}
		category := atlas.ScanCategoryContainer
		if info, statErr := os.Stat(c.MirrorPath); statErr == nil && !info.IsDir() {
			category = atlas.ClassifyScanExtension(filepath.Ext(c.MirrorPath))
		}
		if _, known := byCategory[category]; !known {
			byCategory[category] = c.KindID
		}
	}
	fallback := container.KindID
	for _, k := range byCategory {
		fallback = k
		break
	}
	result := make(map[string]string, 3)
	for _, category := range []atlas.ScanCategory{atlas.ScanCategoryFile, atlas.ScanCategoryImage, atlas.ScanCategoryContainer} {
		if k, ok := byCategory[category]; ok {
			result[string(category)] = k
		} else {
			result[string(category)] = fallback
		}
	}
	return result
}

// reconcileVanishedMirrors compares before (the mirrored descendants
// known prior to this refresh) against fresh (this refresh's own
// scan): anything in before whose MirrorPath isn't among fresh's own
// absolute paths anymore is marked missing. A descendant that
// reappears with UNCHANGED content is also cleared here explicitly --
// syncMirrorCard's own checksum-match shortcut treats that as a pure
// no-op and never revisits it, so this is the only place that clears
// it for that specific case (a changed-content reappearance already
// clears via refreshMirrorCard's own stampSynced call). Each card's
// own transition is delegated to reconcileOneMirror so this loop stays
// a flat, single-branch dispatch.
func (a *AtlasService) reconcileVanishedMirrors(root string, fresh []FolderScanEntry, before []atlas.Card) error {
	present := presentMirrorPaths(root, fresh)
	for _, c := range before {
		if err := a.reconcileOneMirror(c, present[c.MirrorPath]); err != nil {
			return err
		}
	}
	return nil
}

// presentMirrorPaths resolves fresh's own scanned entries to the
// absolute paths they'd carry as a MirrorPath -- reconcileVanishedMirrors'
// own "did this still get found" lookup table.
func presentMirrorPaths(root string, fresh []FolderScanEntry) map[string]bool {
	present := make(map[string]bool, len(fresh))
	for _, e := range fresh {
		present[filepath.Join(root, filepath.FromSlash(e.RelPath))] = true
	}
	return present
}

// reconcileOneMirror applies c's own present/missing transition: found
// again while marked missing clears the mark (via stampSynced, same
// stamp a real content change already gets); no longer found while NOT
// already marked missing sets it. Either card already in its correct
// state is a no-op, so a repeated refresh never re-persists anything
// for it.
func (a *AtlasService) reconcileOneMirror(c atlas.Card, stillPresent bool) error {
	if stillPresent {
		if !c.MirrorMissing {
			return nil
		}
		_, err := a.stampSynced(c.ID)
		return err
	}
	if c.MirrorMissing {
		return nil
	}
	return a.markMirrorMissing(c.ID)
}

// markMirrorMissing sets MirrorMissing on cardID -- the source at its
// MirrorPath could not be found on this refresh. A no-op (no extra
// persist) when it's already marked.
func (a *AtlasService) markMirrorMissing(cardID string) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	idx := a.findCardLocked(cardID)
	if idx == -1 {
		return fmt.Errorf("no card with id %q", cardID)
	}
	if a.cards[idx].MirrorMissing {
		return nil
	}
	a.cards[idx].MirrorMissing = true
	return a.persistLocked()
}
