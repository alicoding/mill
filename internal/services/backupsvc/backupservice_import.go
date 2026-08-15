package backupsvc

import (
	"archive/zip"
	"bytes"
	"encoding/base64"
	"fmt"
	"time"
)

// FamilySummary is one archive family's counted contribution to an
// ImportEverythingSummary -- Total is always the archive's own item
// count; Created/Updated are populated once the classification against
// locally-known ids has actually run (both PreviewImportEverything and
// ImportEverything compute them, the former without mutating anything,
// the latter as a byproduct of actually applying each entry).
type FamilySummary struct {
	Name    string `json:"name"`
	Total   int    `json:"total"`
	Created int    `json:"created"`
	Updated int    `json:"updated"`
}

// ImportEverythingSummary is PreviewImportEverything/ImportEverything's
// shared Wails-bound return shape -- the frontend renders the same
// summary component for both, per capture-first-then-confirm's own
// "mirror useImportConfirm" bar (docs/goals/0065).
type ImportEverythingSummary struct {
	Families        []FamilySummary `json:"families"`
	SnapshotPresent bool            `json:"snapshotPresent"`
	SnapshotTakenAt time.Time       `json:"snapshotTakenAt"`
}

// openArchive base64-decodes and opens data as a zip -- shared by
// Preview and Import, the two read entry points into an
// export-everything archive.
func openArchive(data string) (*zip.Reader, manifest, error) {
	raw, err := base64.StdEncoding.DecodeString(data)
	if err != nil {
		return nil, manifest{}, fmt.Errorf("import everything: invalid archive encoding: %w", err)
	}
	zr, err := zip.NewReader(bytes.NewReader(raw), int64(len(raw)))
	if err != nil {
		return nil, manifest{}, fmt.Errorf("import everything: invalid archive: %w", err)
	}
	man, err := readArchiveManifest(zr)
	if err != nil {
		return nil, manifest{}, err
	}
	return zr, man, nil
}

// PreviewImportEverything parses archiveData (ExportEverything's own
// output) WITHOUT applying anything -- every FamilyBundle.IDs()/
// atlas item count below is a read-only call, so this is safe to run
// against a file the user just picked, before they've confirmed
// anything (the file-picker-then-preview-then-confirm bar
// useImportConfirm.tsx already establishes for every single-entity
// import surface, extended here to the whole archive).
func (b *BackupService) PreviewImportEverything(archiveData string) (ImportEverythingSummary, error) {
	b.mu.Lock()
	families := b.families
	b.mu.Unlock()

	zr, man, err := openArchive(archiveData)
	if err != nil {
		return ImportEverythingSummary{}, err
	}

	summary := ImportEverythingSummary{}
	for _, fam := range families {
		fs, err := previewFamily(zr, fam)
		if err != nil {
			return ImportEverythingSummary{}, err
		}
		if fs != nil {
			summary.Families = append(summary.Families, *fs)
		}
	}

	if data, err := readWholeFile(zr, "atlas.json"); err == nil {
		if total := countAtlasItems(data); total > 0 {
			summary.Families = append(summary.Families, FamilySummary{Name: "atlas", Total: total})
		}
	}

	summary.SnapshotPresent = hasZipEntry(zr, "db-snapshot/execution.db")
	summary.SnapshotTakenAt = man.TakenAt
	return summary, nil
}

func previewFamily(zr *zip.Reader, fam FamilyBundle) (*FamilySummary, error) {
	entries, err := familyEntries(zr, fam.Name)
	if err != nil {
		return nil, err
	}
	if len(entries) == 0 {
		return nil, nil
	}
	existing := toSet(fam.IDs())
	fs := FamilySummary{Name: fam.Name, Total: len(entries)}
	for _, e := range entries {
		if e.id != "" && existing[e.id] {
			fs.Updated++
		} else {
			fs.Created++
		}
	}
	return &fs, nil
}

// ImportEverything applies archiveData's every family through that
// family's own existing Import func (ADR-0036 decision 3's uniform
// import rule, unchanged) and Atlas's own ImportAtlas, in the same
// create-vs-update classification PreviewImportEverything already
// showed the user. The bundled database snapshot is never restored
// here -- docs/goals/0065's own scoped decision: execution-DB restore
// stays a documented closed-app file swap, not an in-app action (a
// live DBOS runtime cannot safely have its own backing store replaced
// out from under it while running).
func (b *BackupService) ImportEverything(archiveData string) (ImportEverythingSummary, error) {
	b.mu.Lock()
	families := b.families
	atlas := b.atlas
	b.mu.Unlock()

	zr, man, err := openArchive(archiveData)
	if err != nil {
		return ImportEverythingSummary{}, err
	}

	summary := ImportEverythingSummary{}
	for _, fam := range families {
		fs, err := applyFamily(zr, fam)
		if err != nil {
			return summary, err
		}
		if fs != nil {
			summary.Families = append(summary.Families, *fs)
		}
	}

	if atlas.apply != nil {
		if data, err := readWholeFile(zr, "atlas.json"); err == nil && countAtlasItems(data) > 0 {
			created, updated, err := atlas.apply(data)
			if err != nil {
				return summary, fmt.Errorf("import everything: atlas: %w", err)
			}
			summary.Families = append(summary.Families, FamilySummary{Name: "atlas", Total: created + updated, Created: created, Updated: updated})
		}
	}

	summary.SnapshotPresent = hasZipEntry(zr, "db-snapshot/execution.db")
	summary.SnapshotTakenAt = man.TakenAt
	return summary, nil
}

func applyFamily(zr *zip.Reader, fam FamilyBundle) (*FamilySummary, error) {
	entries, err := familyEntries(zr, fam.Name)
	if err != nil {
		return nil, err
	}
	if len(entries) == 0 {
		return nil, nil
	}
	existing := toSet(fam.IDs())
	fs := FamilySummary{Name: fam.Name, Total: len(entries)}
	for _, e := range entries {
		wasKnown := e.id != "" && existing[e.id]
		if _, err := fam.Import(e.data); err != nil {
			return &fs, fmt.Errorf("import everything: %s: %w", fam.Name, err)
		}
		if wasKnown {
			fs.Updated++
		} else {
			fs.Created++
		}
	}
	return &fs, nil
}
