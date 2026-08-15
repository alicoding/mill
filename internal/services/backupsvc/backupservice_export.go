package backupsvc

import (
	"archive/zip"
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/alicoding/mill/internal/adapters/backup"
)

// ExportEverything bundles every ADR-0036 entity-family envelope
// (via each wired FamilyBundle.Export + the Atlas bundle) alongside a
// fresh database snapshot into one zip archive, base64-encoded (the
// same string-return convention every other Export* method in this
// codebase already uses, rather than a raw []byte binding whose
// frontend marshaling shape isn't otherwise established here). The
// snapshot is taken into a throwaway temp directory -- never the real
// backup rotation dir, and never subject to its keep-N pruning -- so
// calling this repeatedly has no effect on BackupNow's own retained
// history.
func (b *BackupService) ExportEverything() (string, error) {
	b.mu.Lock()
	families := b.families
	atlas := b.atlas
	dbPath, settingsPath, millVersion := b.dbPath, b.settingsPath, b.millVersion
	b.mu.Unlock()

	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)

	man := manifest{Schema: manifestSchema, MillVersion: millVersion, TakenAt: time.Now()}

	for _, fam := range families {
		for _, id := range fam.IDs() {
			data, err := fam.Export(id)
			if err != nil {
				return "", fmt.Errorf("export everything: %s %q: %w", fam.Name, id, err)
			}
			if err := writeZipFile(zw, fam.Name+"/"+id+".json", data); err != nil {
				return "", err
			}
		}
	}

	if atlas.export != nil {
		data, err := atlas.export()
		if err != nil {
			return "", fmt.Errorf("export everything: atlas: %w", err)
		}
		if err := writeZipFile(zw, "atlas.json", data); err != nil {
			return "", err
		}
	}

	if dbPath != "" {
		if err := includeSnapshot(zw, dbPath, settingsPath); err != nil {
			return "", err
		}
		man.HasSnapshot = true
	}

	manData, err := json.MarshalIndent(man, "", "  ")
	if err != nil {
		return "", fmt.Errorf("export everything: manifest: %w", err)
	}
	if err := writeZipFile(zw, "manifest.json", string(manData)); err != nil {
		return "", err
	}

	if err := zw.Close(); err != nil {
		return "", fmt.Errorf("export everything: close archive: %w", err)
	}
	return base64.StdEncoding.EncodeToString(buf.Bytes()), nil
}

// includeSnapshot takes one throwaway VACUUM INTO snapshot (keepN=0:
// nothing to prune, this directory is deleted right after) and writes
// its execution.db (+ settings.json, if the copy produced one) into
// zw under db-snapshot/.
func includeSnapshot(zw *zip.Writer, dbPath, settingsPath string) error {
	tmpDir, err := os.MkdirTemp("", "mill-export-snapshot-")
	if err != nil {
		return fmt.Errorf("export everything: snapshot temp dir: %w", err)
	}
	defer func() { _ = os.RemoveAll(tmpDir) }()

	result, err := backup.Snapshot(dbPath, settingsPath, tmpDir, 0)
	if err != nil {
		return fmt.Errorf("export everything: snapshot: %w", err)
	}

	if err := writeZipFileFromDisk(zw, "db-snapshot/execution.db", filepath.Join(result.Dir, "execution.db")); err != nil {
		return err
	}
	if _, err := os.Stat(filepath.Join(result.Dir, "settings.json")); err == nil {
		if err := writeZipFileFromDisk(zw, "db-snapshot/settings.json", filepath.Join(result.Dir, "settings.json")); err != nil {
			return err
		}
	}
	return nil
}

func writeZipFileFromDisk(zw *zip.Writer, name, path string) error {
	data, err := os.ReadFile(path) //nolint:gosec // Mill-owned throwaway temp snapshot path minted above, not external input
	if err != nil {
		return fmt.Errorf("export everything: read %q: %w", path, err)
	}
	return writeZipFile(zw, name, string(data))
}
