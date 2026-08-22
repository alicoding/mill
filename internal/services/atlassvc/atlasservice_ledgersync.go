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

// The Delivered-feature Kind's four mirror-owned field keys (docs/
// goals/0164's DESIGN CONTRACT item 2) -- the only keys this file's
// MergeCardFields calls ever write. signoff/verifiedAt/notes are
// owner-owned and never appear in ledgerMirrorFields' output.
const (
	ledgerFieldGoalID      = "goalId"
	ledgerFieldShippedDate = "shippedDate"
	ledgerFieldPRs         = "prs"
	ledgerFieldProof       = "proof"
	ledgerFieldSignoff     = "signoff"
)

// SyncLedgerFolder regenerates one parent card's mirror children from a
// folder of frontmattered goal files (goal 0164 L1): a file already
// mirrored by a live card keeps that card, and a content change
// refreshes its checksum plus re-merges ONLY its mirror-owned fields
// (goal, shipped date, PRs, proof) -- sign-off, verified date, and
// notes are owner state a re-sync must never clobber, the ledger's own
// durability requirement. A new file becomes a new card, pending-
// verify by default. A file with no frontmatter, or frontmatter that
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

	kindID, parentID, byMirror, err := a.ledgerSyncTargetsLocked(parentTitle)
	if err != nil {
		return "", err
	}

	if parentID == "" && parentTitle != "" {
		parent, err := a.createCardWithID(seeding.NewSlugID(parentTitle, "card"), kindID, parentTitle, "", nil, "", nil, "", "", "", "", "", sourceRunID)
		if err != nil {
			return "", fmt.Errorf("sync ledger folder: create parent %q: %w", parentTitle, err)
		}
		parentID = parent.ID
	}

	created, refreshed, ids, err := a.syncScannedLedgerDocs(scanned.Entries, folderPath, kindID, parentID, sourceRunID, byMirror)
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
func (a *AtlasService) ledgerSyncTargetsLocked(parentTitle string) (kindID, parentID string, byMirror map[string]atlas.Card, err error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if len(a.kinds) == 0 {
		return "", "", nil, fmt.Errorf("sync ledger folder: no card kinds exist to create into")
	}
	kindID = ledgerDeliveredFeatureKindID
	if a.findKindLocked(kindID) == -1 {
		kindID = a.kinds[0].ID
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

// syncScannedLedgerDocs walks the scan's markdown entries through
// syncOneLedgerDoc, aggregating the summary counts.
func (a *AtlasService) syncScannedLedgerDocs(entries []fileread.Entry, folderPath, kindID, parentID, sourceRunID string, byMirror map[string]atlas.Card) (created, refreshed int, ids []string, err error) {
	for _, e := range entries {
		if e.IsDir || !strings.EqualFold(e.Ext, ".md") {
			continue
		}
		id, madeNew, wasRefreshed, err := a.syncOneLedgerDoc(folderPath, e.RelPath, e.Name, kindID, parentID, sourceRunID, byMirror)
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
// frontmatter, re-merges ONLY the four mirror-owned fields via
// MergeCardFields -- signoff/verifiedAt/notes are never in that map,
// so an owner's sign-off survives every re-sync by construction. A new
// file becomes a new card, seeded with signoff already at its Default.
// A file with no parseable frontmatter (new or changed) skips the
// field write -- an unreadable/unparseable file is never fatal to the
// rest of the folder's sync.
func (a *AtlasService) syncOneLedgerDoc(folderPath, relPath, name, kindID, parentID, sourceRunID string, byMirror map[string]atlas.Card) (id string, created, refreshed bool, err error) {
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
	fm, hasFrontmatter := parseLedgerFrontmatter(content)

	if hasExisting {
		if err := a.setMirrorChecksum(existing.ID, sum); err != nil {
			return "", false, false, fmt.Errorf("sync ledger folder: refresh %q: %w", existing.Title, err)
		}
		if hasFrontmatter {
			if _, err := a.MergeCardFields(existing.ID, ledgerMirrorFields(fm), sourceRunID); err != nil {
				return "", false, false, fmt.Errorf("sync ledger folder: merge fields for %q: %w", existing.Title, err)
			}
		}
		return existing.ID, false, true, nil
	}

	if !hasFrontmatter {
		return "", false, false, nil
	}
	fields := ledgerMirrorFields(fm)
	fields[ledgerFieldSignoff] = "pending-verify"
	card, err := a.createCardWithID(seeding.NewSlugID(atlas.HumanizeFilename(name), "card"), kindID, atlas.HumanizeFilename(name), "", fields, parentID, nil, "", "", abs, sum, "", sourceRunID)
	if err != nil {
		return "", false, false, fmt.Errorf("sync ledger folder: create for %q: %w", name, err)
	}
	return card.ID, true, false, nil
}

// parseLedgerFrontmatter wraps atlas.ParseFrontmatter, treating a parse
// ERROR the same as no-frontmatter-present -- a malformed header must
// never abort the whole folder's sync, only that one file's mirror.
func parseLedgerFrontmatter(content []byte) (atlas.GoalFrontmatter, bool) {
	fm, ok, err := atlas.ParseFrontmatter(content)
	if err != nil || !ok {
		return atlas.GoalFrontmatter{}, false
	}
	return fm, true
}

// ledgerMirrorFields maps a parsed frontmatter header onto the
// Delivered-feature Kind's four mirror-owned field keys -- the exact
// set docs/goals/0164's DESIGN CONTRACT item 2 names, never signoff/
// verifiedAt/notes.
func ledgerMirrorFields(fm atlas.GoalFrontmatter) map[string]string {
	return map[string]string{
		ledgerFieldGoalID:      fm.ID,
		ledgerFieldShippedDate: fm.Date,
		ledgerFieldPRs:         strings.Join(fm.PRs, ", "),
		ledgerFieldProof:       strings.Join(fm.Proof, ", "),
	}
}
