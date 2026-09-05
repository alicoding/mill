package secretsvc

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/alicoding/mill/internal/adapters/dotenvscan"
	"github.com/alicoding/mill/internal/adapters/dotenvsource"
	"github.com/alicoding/mill/internal/adapters/windowing"
	"github.com/alicoding/mill/internal/domain/secret"
	"github.com/alicoding/mill/internal/services/dataevent"
)

// Finding .env files (goal 0306 S4): a reader points Mill at ONE
// folder and Mill lists the dotenv files under it, so the sources they
// would become are chosen rather than assumed. Nothing here scans
// without a folder, and nothing defaults to the home directory --
// ADR-0050's posture is that a credential reader never wanders.

// DotenvFound is one file the scan turned up, as the results table
// renders it.
type DotenvFound struct {
	// RelPath is the path shown, relative to the chosen folder.
	RelPath string
	// Path is the absolute path a source would be created with.
	Path string
	// Keys counts what the file holds -- names only, never a value.
	Keys int
	// Label is what a source created from this file would be called;
	// Tag is what an entry imported out of it would be tagged with.
	Label string
	Tag   string
}

// ChooseScanFolder opens the machine's own folder picker and returns
// what the reader chose ("" when they cancelled). Unavailable outside
// the desktop app, where the surface asks for a typed path instead.
func (s *SecretService) ChooseScanFolder() (string, error) {
	return windowing.PickFolder("Choose a folder to scan", "")
}

// FindDotenvFiles lists the dotenv files under folder.
func (s *SecretService) FindDotenvFiles(folder string) ([]DotenvFound, error) {
	found, err := dotenvscan.Scan(expandUserHome(folder))
	if err != nil {
		return nil, err
	}
	out := make([]DotenvFound, 0, len(found))
	for _, f := range found {
		out = append(out, DotenvFound{
			RelPath: f.RelPath, Path: f.Path, Keys: f.Keys,
			Label: dotenvscan.SourceLabel(folder, f), Tag: dotenvscan.ImportTag(folder, f),
		})
	}
	return out, nil
}

// SourceCreator is the seam that adds a secret source, wired to
// configuresvc so this service keeps no dependency on it.
type SourceCreator func(label, kind, path string) error

// SetSourceCreator wires that seam. Exported for wiring only, never a
// frontend RPC.
//
//wails:ignore
func (s *SecretService) SetSourceCreator(fn SourceCreator) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.createSource = fn
}

// AddDotenvSources creates one dotenv source per chosen path, returning
// how many were added.
func (s *SecretService) AddDotenvSources(folder string, paths []string) (int, error) {
	s.mu.Lock()
	create := s.createSource
	s.mu.Unlock()
	if create == nil {
		return 0, fmt.Errorf("secret sources are not available in this mode")
	}
	found, err := s.FindDotenvFiles(folder)
	if err != nil {
		return 0, err
	}
	chosen := chosenSet(paths)
	added := 0
	for _, f := range found {
		if !chosen[f.Path] {
			continue
		}
		if err := create(f.Label, "env", f.Path); err != nil {
			return added, err
		}
		added++
	}
	return added, nil
}

// ImportDotenvKeys stores every key of the chosen files as its own
// entry: the key's name as the title, the folder it came from as a
// tag, and the file it came from recorded on the entry. Returns how
// many entries were created.
func (s *SecretService) ImportDotenvKeys(folder string, paths []string) (int, error) {
	found, err := s.FindDotenvFiles(folder)
	if err != nil {
		return 0, err
	}
	chosen := chosenSet(paths)
	imported := 0
	for _, f := range found {
		if !chosen[f.Path] {
			continue
		}
		values, err := dotenvsource.Read(f.Path)
		if err != nil {
			continue
		}
		for key, value := range values {
			e := secret.Entry{Title: key, Password: value, Kind: secret.KindText, Tags: []string{f.Tag}, Origin: "import:" + f.RelPath}
			created, err := s.vault.Upsert(e)
			if err != nil {
				return imported, err
			}
			dataevent.Emit("secret", created.ID)
			imported++
		}
	}
	return imported, nil
}

func chosenSet(paths []string) map[string]bool {
	out := make(map[string]bool, len(paths))
	for _, p := range paths {
		out[p] = true
	}
	return out
}

// expandUserHome resolves a leading "~" the way a typed path is
// written; an empty path stays empty so Scan refuses it by name.
func expandUserHome(path string) string {
	if path != "~" && !strings.HasPrefix(path, "~"+string(filepath.Separator)) {
		return path
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return path
	}
	return filepath.Join(home, strings.TrimPrefix(path, "~"))
}
