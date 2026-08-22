package atlassvc

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/alicoding/mill/internal/adapters/fileread"
	"github.com/alicoding/mill/internal/domain/atlas"
	"github.com/alicoding/mill/internal/services/dataevent"
	"github.com/alicoding/mill/internal/services/seeding"
)

// ledgerDeliveredFeatureKindID is a literal copy of internal/domain/
// atlas's own seeded Delivered-feature Kind ID -- the same sanctioned
// seed-to-seed wiring atlasservice_filedrop.go's fileDrop*KindID
// constants already carry (an ID *value* copy, never the Label/
// Description text, so ADR-0038's no-hardcode tripwire stays
// meaningful): a ledger sync has to name an actual Kind
// deterministically, no popover asks.
const ledgerDeliveredFeatureKindID = "atlas-kind-delivered-feature"

// ledgerFieldSignoff is the one field this file still names directly:
// a brand-new card is seeded pending-verify even though no frontmatter
// file ever carries a "signoff" key of its own (goal 0172's Kind-is-
// the-contract mirror never writes a key absent from the file).
const ledgerFieldSignoff = "signoff"

// SyncLedgerFolder regenerates one parent card's mirror children from a
// folder of frontmattered markdown files (goal 0164 L1, generalized by
// goal 0172): a file already mirrored by a live card keeps that card,
// and a content change refreshes its checksum plus re-merges ONLY the
// Kind fields the file's own frontmatter actually names (goal 0172's
// CoerceFrontmatterFields) -- any Kind field the file doesn't carry
// (sign-off, verified date, notes on the seeded Delivered-feature Kind,
// or an equivalent owner-owned field on any other Kind) is simply
// absent from that map, so a re-sync can never clobber it. A new file
// becomes a new card. A file with no frontmatter, or frontmatter that
// fails to parse, is skipped -- the next run picks it up once fixed,
// the same leniency SyncDocsFolder applies to an unreadable file. Not
// a frontend RPC: composition calls this through
// composition.SetAtlasLedgerSync, never Wails directly.
//
//wails:ignore
func (a *AtlasService) SyncLedgerFolder(folderPath, parentTitle, sourceRunID string) (string, error) {
	a.mu.RLock()
	guardErr := a.guardSyncedFolderLocked(folderPath)
	a.mu.RUnlock()
	if guardErr != nil {
		return "", guardErr
	}
	scanned, err := fileread.Scan(folderPath, DefaultScanMaxDepth, DefaultScanMaxEntries)
	if err != nil {
		return "", fmt.Errorf("sync ledger folder: %w", err)
	}

	kind, parentID, byMirror, err := a.ledgerSyncTargetsLocked(parentTitle)
	if err != nil {
		return "", err
	}

	if parentID == "" && parentTitle != "" {
		parent, err := a.createCardWithID(seeding.NewSlugID(parentTitle, "card"), kind.ID, parentTitle, "", nil, "", nil, "", "", "", "", "", sourceRunID)
		if err != nil {
			return "", fmt.Errorf("sync ledger folder: create parent %q: %w", parentTitle, err)
		}
		parentID = parent.ID
	}

	created, refreshed, ids, err := a.syncScannedLedgerDocs(scanned.Entries, folderPath, kind, parentID, sourceRunID, byMirror)
	if err != nil {
		return "", err
	}

	if created > 0 || refreshed > 0 {
		dataevent.Emit("atlas", parentID)
	}
	out, _ := json.Marshal(map[string]any{"created": created, "refreshed": refreshed, "ids": ids})
	return string(out), nil
}

// ledgerSyncTargetsLocked resolves the ledger sync's kind, any existing
// parent, and the live mirror index in one locked pass -- mirrors
// docsSyncTargetsLocked, but the kind is always the seeded Delivered
// feature Kind (falling back to whichever Kind IS present when it's
// been deleted/renamed, resolveDropKindLocked's own graceful shape in
// atlasservice_filedrop.go), never a caller-chosen label: a ledger
// card's mirror-owned/owner-owned split only makes sense for that one
// Kind's schema.
func (a *AtlasService) ledgerSyncTargetsLocked(parentTitle string) (kind atlas.Kind, parentID string, byMirror map[string]atlas.Card, err error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if len(a.kinds) == 0 {
		return atlas.Kind{}, "", nil, fmt.Errorf("sync ledger folder: no card kinds exist to create into")
	}
	kindID := ledgerDeliveredFeatureKindID
	if a.findKindLocked(kindID) == -1 {
		kindID = a.kinds[0].ID
	}
	kind, err = a.resolveKindLocked(kindID)
	if err != nil {
		return atlas.Kind{}, "", nil, err
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
	return kind, parentID, byMirror, nil
}

// syncScannedLedgerDocs walks the scan's markdown entries through
// syncOneLedgerDoc, aggregating the summary counts.
func (a *AtlasService) syncScannedLedgerDocs(entries []fileread.Entry, folderPath string, kind atlas.Kind, parentID, sourceRunID string, byMirror map[string]atlas.Card) (created, refreshed int, ids []string, err error) {
	for _, e := range entries {
		if e.IsDir || !strings.EqualFold(e.Ext, ".md") {
			continue
		}
		id, madeNew, wasRefreshed, err := a.syncOneLedgerDoc(folderPath, e.RelPath, e.Name, kind, parentID, sourceRunID, byMirror)
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

// syncOneLedgerDoc mirrors one markdown file. An existing mirror card
// with an unchanged checksum is a pure no-op. A content change
// refreshes the checksum and, when the new content still parses as
// frontmatter, re-merges only the Kind fields the header actually
// names (atlas.CoerceFrontmatterFields) via MergeCardFields -- a Kind
// field absent from that map is never touched, so an owner-owned value
// survives every re-sync by construction. A new file becomes a new
// card, seeded with signoff already at its Default. A file with no
// parseable frontmatter (new or changed) skips the field write -- an
// unreadable/unparseable file is never fatal to the rest of the
// folder's sync.
func (a *AtlasService) syncOneLedgerDoc(folderPath, relPath, name string, kind atlas.Kind, parentID, sourceRunID string, byMirror map[string]atlas.Card) (id string, created, refreshed bool, err error) {
	abs := filepath.Join(folderPath, filepath.FromSlash(relPath))
	sum, csErr := fileChecksum(abs)
	if csErr != nil {
		return "", false, false, nil
	}
	existing, hasExisting := byMirror[abs]
	if hasExisting && existing.MirrorChecksum == sum {
		return existing.ID, false, false, nil
	}

	content, rdErr := os.ReadFile(abs) //nolint:gosec // path built from a folder the caller configured, scanned via fileread.Scan
	if rdErr != nil {
		return "", false, false, nil
	}
	raw, hasFrontmatter := parseLedgerFrontmatter(content)

	if hasExisting {
		if err := a.setMirrorChecksum(existing.ID, sum); err != nil {
			return "", false, false, fmt.Errorf("sync ledger folder: refresh %q: %w", existing.Title, err)
		}
		if hasFrontmatter {
			fields := atlas.CoerceFrontmatterFields(raw, kind.Fields)
			if _, err := a.MergeCardFields(existing.ID, fields, sourceRunID); err != nil {
				return "", false, false, fmt.Errorf("sync ledger folder: merge fields for %q: %w", existing.Title, err)
			}
		}
		return existing.ID, false, true, nil
	}

	if !hasFrontmatter {
		return "", false, false, nil
	}
	fields := atlas.CoerceFrontmatterFields(raw, kind.Fields)
	fields[ledgerFieldSignoff] = "pending-verify"
	card, err := a.createCardWithID(seeding.NewSlugID(atlas.HumanizeFilename(name), "card"), kind.ID, atlas.HumanizeFilename(name), "", fields, parentID, nil, "", "", abs, sum, "", sourceRunID)
	if err != nil {
		return "", false, false, fmt.Errorf("sync ledger folder: create for %q: %w", name, err)
	}
	return card.ID, true, false, nil
}

// parseLedgerFrontmatter wraps atlas.ParseFrontmatter, treating a parse
// ERROR the same as no-frontmatter-present -- a malformed header must
// never abort the whole folder's sync, only that one file's mirror.
func parseLedgerFrontmatter(content []byte) (map[string]any, bool) {
	raw, ok, err := atlas.ParseFrontmatter(content)
	if err != nil || !ok {
		return nil, false
	}
	return raw, true
}
