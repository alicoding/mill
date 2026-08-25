package atlassvc

import (
	"encoding/json"
	"fmt"
	"path/filepath"
	"strings"

	"github.com/alicoding/mill/internal/adapters/fileread"
	"github.com/alicoding/mill/internal/domain/atlas"
	"github.com/alicoding/mill/internal/services/dataevent"
	"github.com/alicoding/mill/internal/services/seeding"
)

// SyncDocsFolder regenerates one parent card's mirror children from a
// folder of markdown files (goal 0108's generated-from-docs decision):
// a file already mirrored by a live card keeps that card (checksum
// refreshed so staleness stays honest), a new file becomes a new
// mirror card, so re-running is always safe. Deliberately markdown-
// only and non-recursive-flattening: the scan's own depth cap applies,
// and every matched file lands directly under the one parent -- the
// docs sets this exists for (architecture views, maintained notes)
// are flat folders whose structure lives in the documents themselves.
// Not a frontend RPC: composition calls this through
// composition.SetAtlasDocsSync, never Wails directly.
//
//wails:ignore
func (a *AtlasService) SyncDocsFolder(folderPath, parentTitle, kindLabel, sourceRunID string) (string, error) {
	a.mu.RLock()
	guardErr := a.guardSyncedFolderLocked(folderPath)
	a.mu.RUnlock()
	if guardErr != nil {
		return "", guardErr
	}
	scanned, err := fileread.Scan(folderPath, DefaultScanMaxDepth, DefaultScanMaxEntries)
	if err != nil {
		return "", fmt.Errorf("sync docs folder: %w", err)
	}

	kindID, parentID, byMirror, err := a.docsSyncTargetsLocked(parentTitle, kindLabel)
	if err != nil {
		return "", err
	}

	if parentID == "" && parentTitle != "" {
		parent, err := a.createCardWithID(seeding.NewSlugID(parentTitle, "card"), kindID, parentTitle, "", nil, "", nil, "", "", "", "", "", sourceRunID, "")
		if err != nil {
			return "", fmt.Errorf("sync docs folder: create parent %q: %w", parentTitle, err)
		}
		parentID = parent.ID
	}

	created, refreshed, ids, err := a.syncScannedDocs(scanned.Entries, folderPath, kindID, parentID, sourceRunID, byMirror)
	if err != nil {
		return "", err
	}

	if created > 0 || refreshed > 0 {
		dataevent.Emit("atlas", parentID)
	}
	out, _ := json.Marshal(map[string]any{"created": created, "refreshed": refreshed, "ids": ids})
	return string(out), nil
}

// syncScannedDocs walks the scan's markdown entries through syncOneDoc,
// aggregating the summary counts.
func (a *AtlasService) syncScannedDocs(entries []fileread.Entry, folderPath, kindID, parentID, sourceRunID string, byMirror map[string]atlas.Card) (created, refreshed int, ids []string, err error) {
	for _, e := range entries {
		if e.IsDir || !strings.EqualFold(e.Ext, ".md") {
			continue
		}
		id, madeNew, wasRefreshed, err := a.syncOneDoc(folderPath, e.RelPath, e.Name, kindID, parentID, sourceRunID, byMirror)
		if err != nil {
			return 0, 0, nil, err
		}
		if id == "" {
			continue
		}
		if madeNew {
			created++
		}
		if wasRefreshed {
			refreshed++
		}
		ids = append(ids, id)
	}
	return created, refreshed, ids, nil
}

// docsSyncTargetsLocked resolves the sync's kind, any existing parent,
// and the live mirror index in one locked pass. An empty label takes
// the first declared kind -- the same no-concept-hardcoded default
// materializeReplyItems uses.
func (a *AtlasService) docsSyncTargetsLocked(parentTitle, kindLabel string) (kindID, parentID string, byMirror map[string]atlas.Card, err error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if len(a.kinds) == 0 {
		return "", "", nil, fmt.Errorf("sync docs folder: no card kinds exist to create into")
	}
	kindID = a.kinds[0].ID
	if kindLabel != "" {
		kindID = ""
		for i := range a.kinds {
			if strings.EqualFold(a.kinds[i].Label, kindLabel) {
				kindID = a.kinds[i].ID
				break
			}
		}
		if kindID == "" {
			return "", "", nil, fmt.Errorf("sync docs folder: no kind labeled %q", kindLabel)
		}
	}
	byMirror = map[string]atlas.Card{}
	for _, c := range a.liveCardsLocked() {
		if c.MirrorPath != "" {
			byMirror[c.MirrorPath] = c
		}
		if parentTitle != "" && strings.EqualFold(strings.TrimSpace(c.Title), strings.TrimSpace(parentTitle)) {
			parentID = c.ID
		}
	}
	return kindID, parentID, byMirror, nil
}

// syncOneDoc mirrors one markdown file: an existing mirror card keeps
// its identity (checksum refreshed when the content changed), a new
// file becomes a new card. An unreadable file is skipped -- the next
// run picks it up once readable -- reported as an empty id.
func (a *AtlasService) syncOneDoc(folderPath, relPath, name, kindID, parentID, sourceRunID string, byMirror map[string]atlas.Card) (id string, created, refreshed bool, err error) {
	abs := filepath.Join(folderPath, filepath.FromSlash(relPath))
	sum, csErr := fileChecksum(abs)
	if csErr != nil {
		return "", false, false, nil
	}
	if existing, ok := byMirror[abs]; ok {
		if existing.MirrorChecksum != sum {
			if err := a.setMirrorChecksum(existing.ID, sum); err != nil {
				return "", false, false, fmt.Errorf("sync docs folder: refresh %q: %w", existing.Title, err)
			}
			return existing.ID, false, true, nil
		}
		return existing.ID, false, false, nil
	}
	card, err := a.createCardWithID(seeding.NewSlugID(atlas.HumanizeFilename(name), "card"), kindID, atlas.HumanizeFilename(name), "", nil, parentID, nil, "", "", abs, sum, "", sourceRunID, "")
	if err != nil {
		return "", false, false, fmt.Errorf("sync docs folder: create for %q: %w", name, err)
	}
	return card.ID, true, false, nil
}

// setMirrorChecksum updates one card's stored checksum in place.
func (a *AtlasService) setMirrorChecksum(cardID, sum string) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	for i := range a.cards {
		if a.cards[i].ID == cardID {
			a.cards[i].MirrorChecksum = sum
			return a.persistLocked()
		}
	}
	return fmt.Errorf("no card with id %q", cardID)
}
