package secretsvc

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"

	"github.com/alicoding/mill/internal/adapters/secretimport"
	"github.com/alicoding/mill/internal/adapters/windowing"
	"github.com/alicoding/mill/internal/domain/secret"
	"github.com/alicoding/mill/internal/domain/usererror"
	"github.com/alicoding/mill/internal/services/dataevent"
)

// Importing from an export (goal 0306 S4): the reader exports from the
// tool they already use, Mill reads that file, and offers to delete it
// straight after. Mill never reads another application's credential
// DATABASE -- that is the technique ADR-0050 refuses (MITRE ATT&CK
// T1555.003), and internal/adapters/secretimport carries the same
// constraint beside its format table.

// importedTag marks every entry that arrived this way, so a reader can
// find and review the whole batch afterwards.
const importedTag = "imported"

// ErrUnreadableExport is what the surface states when no known layout
// matches the file's header. The code is the stable handle; the
// sentence is what the reader sees.
var ErrUnreadableExport = usererror.New("unreadable-export", "Can't read this file as a password export.")

// ImportPreview is what the dialog shows before anything is stored:
// how many entries the file holds, and the file's own name.
type ImportPreview struct {
	Path     string
	FileName string
	Count    int
}

// ChooseExportFile opens the machine's own file picker filtered to CSV
// and returns what the reader chose ("" when they cancelled).
func (s *SecretService) ChooseExportFile() (string, error) {
	return windowing.PickCSVFile("Choose a password export")
}

// PreviewExport reads the file and reports how many entries it holds,
// storing nothing.
func (s *SecretService) PreviewExport(path string) (ImportPreview, error) {
	rows, err := readExport(path)
	if err != nil {
		return ImportPreview{}, err
	}
	return ImportPreview{Path: path, FileName: filepath.Base(path), Count: len(rows)}, nil
}

// ImportExport stores every entry the file holds, tagged so the batch
// stays findable, and deletes the file afterwards when asked -- an
// export holds every password in plain text, so leaving it on disk is
// the risk, not the deletion. Returns how many entries were created.
func (s *SecretService) ImportExport(path string, deleteAfter bool) (int, error) {
	rows, err := readExport(path)
	if err != nil {
		return 0, err
	}
	origin := "import:" + filepath.Base(path)
	imported := 0
	for _, row := range rows {
		e := secret.Entry{
			Title: row.Title, Username: row.Username, Password: row.Password,
			URL: row.URL, Notes: row.Notes, Kind: secret.KindText,
			Tags: []string{importedTag}, Origin: origin,
		}
		if err := secret.Validate(e); err != nil {
			continue
		}
		created, err := s.vault.Upsert(e)
		if err != nil {
			return imported, err
		}
		dataevent.Emit("secret", created.ID)
		imported++
	}
	if deleteAfter {
		if err := os.Remove(path); err != nil {
			return imported, fmt.Errorf("imported %d entries, but the file could not be deleted: %w", imported, err)
		}
	}
	return imported, nil
}

func readExport(path string) ([]secretimport.Row, error) {
	if filepath.Ext(path) == "" {
		return nil, ErrUnreadableExport
	}
	f, err := os.Open(path) // #nosec G304 -- the file the reader chose in the machine's own picker
	if err != nil {
		return nil, ErrUnreadableExport
	}
	defer func() { _ = f.Close() }()
	rows, _, err := secretimport.ReadCSV(f)
	if err != nil {
		if errors.Is(err, secretimport.ErrUnrecognized) {
			return nil, ErrUnreadableExport
		}
		return nil, err
	}
	return rows, nil
}
