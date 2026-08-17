package atlassvc

import (
	"crypto/sha256"
	"encoding/hex"
	"io"
	"log/slog"
	"os"
)

// mirrorChecksumBackfillCap bounds the opportunistic backfill ScanFolder
// runs before every preview (goal 0088): a folder holding thousands of
// pre-existing mirrored cards can't turn one scan into an unbounded
// hashing pass.
const mirrorChecksumBackfillCap = 200

// fileChecksum returns the lowercase-hex SHA-256 of path's content,
// streamed rather than slurped whole into memory -- ScanFolder's own
// backfill pass and preview loop may call this against many files in
// one request.
func fileChecksum(path string) (string, error) {
	f, err := os.Open(path) //nolint:gosec // a mirrored card's own file path, resolved server-side, not client input
	if err != nil {
		return "", err
	}
	defer func() { _ = f.Close() }()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

// checksumIndexLocked maps every card's own MirrorChecksum to its ID --
// cards with no checksum computed yet are absent. Caller must hold a.mu
// (a read lock suffices).
func (a *AtlasService) checksumIndexLocked() map[string]string {
	index := make(map[string]string)
	for _, c := range a.cards {
		if c.MirrorChecksum == "" {
			continue
		}
		index[c.MirrorChecksum] = c.ID
	}
	return index
}

// titlesByIDLocked snapshots every card's own Title keyed by ID --
// paired with checksumIndexLocked so a duplicate match can be reported
// with a human-readable title without re-walking a.cards per entry.
// Caller must hold a.mu (a read lock suffices).
func (a *AtlasService) titlesByIDLocked() map[string]string {
	out := make(map[string]string, len(a.cards))
	for _, c := range a.cards {
		out[c.ID] = c.Title
	}
	return out
}

// backfillMirrorChecksums computes and persists MirrorChecksum for
// existing cards that predate this field: a non-empty MirrorPath whose
// file still exists but whose checksum was never computed, capped at
// mirrorChecksumBackfillCap per call. Candidates are snapshotted under
// a read lock, hashed unlocked (so a slow read of a large mirror file
// never blocks unrelated readers/writers), then applied and persisted
// in one final write-locked pass. A missing or unreadable mirror file
// is skipped silently -- this pass is opportunistic, never a new
// source of user-visible errors.
func (a *AtlasService) backfillMirrorChecksums() {
	a.mu.RLock()
	type candidate struct{ id, path string }
	var candidates []candidate
	for _, c := range a.cards {
		if len(candidates) >= mirrorChecksumBackfillCap {
			break
		}
		if c.MirrorPath == "" || c.MirrorChecksum != "" {
			continue
		}
		candidates = append(candidates, candidate{id: c.ID, path: c.MirrorPath})
	}
	a.mu.RUnlock()
	if len(candidates) == 0 {
		return
	}

	sums := make(map[string]string, len(candidates))
	for _, cand := range candidates {
		if sum, err := fileChecksum(cand.path); err == nil {
			sums[cand.id] = sum
		}
	}
	if len(sums) == 0 {
		return
	}

	a.mu.Lock()
	for i := range a.cards {
		if sum, ok := sums[a.cards[i].ID]; ok {
			a.cards[i].MirrorChecksum = sum
		}
	}
	if err := a.persistLocked(); err != nil {
		slog.Error("failed to backfill Atlas mirror checksums", "error", err)
	}
	a.mu.Unlock()
}
