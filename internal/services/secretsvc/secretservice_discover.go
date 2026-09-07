package secretsvc

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/alicoding/mill/internal/adapters/dotenvscan"
	"github.com/alicoding/mill/internal/adapters/dotenvsource"
	"github.com/alicoding/mill/internal/adapters/windowing"
	"github.com/alicoding/mill/internal/domain/secret"
	"github.com/alicoding/mill/internal/domain/secretsource"
	"github.com/alicoding/mill/internal/domain/usererror"
	"github.com/alicoding/mill/internal/services/dataevent"
)

// Finding .env files (goal 0306 S4): a reader points Mill at ONE
// folder and Mill lists the dotenv files under it, so the sources they
// would become are chosen rather than assumed. Nothing here scans
// without a folder, and nothing defaults to the home directory --
// ADR-0050's posture is that a credential reader never wanders.

// ErrDotenvImportLocked refuses an import into a vault that is not
// open -- up front, so a locked vault never ends a run of imports with
// only some keys stored (goal 0367).
var ErrDotenvImportLocked = usererror.New("vault-locked-import", "Unlock the vault to import keys.")

// DotenvFound is one file the scan turned up, as the results table
// renders it.
type DotenvFound struct {
	// RelPath is the path shown, relative to the chosen folder.
	RelPath string
	// Path is the absolute path a source would be created with.
	Path string
	// Keys counts what the file holds -- names only, never a value.
	Keys int
	// AlreadySource marks a file already configured as a source: the
	// picker shows it disabled rather than adding a duplicate (goal
	// 0367).
	AlreadySource bool
	// Label is what a source created from this file would be called;
	// Tag is what an entry imported out of it would be tagged with.
	Label string
	Tag   string
}

// DotenvSkipped is one dotenv-named file the scan could not read,
// named with its reason in the results view rather than silently
// omitted.
type DotenvSkipped struct {
	RelPath string
	Reason  string
}

// DotenvScanResult is one scan's full answer: the parseable files a
// source or import can come from, and the ones it could not parse.
type DotenvScanResult struct {
	Found   []DotenvFound
	Skipped []DotenvSkipped
}

// ChooseScanFolder opens the machine's own folder picker and returns
// what the reader chose ("" when they cancelled). Unavailable outside
// the desktop app, where the surface asks for a typed path instead.
func (s *SecretService) ChooseScanFolder() (string, error) {
	return windowing.PickFolder("Choose a folder to scan", "")
}

// FindDotenvFiles lists the dotenv files under folder, marking each
// that is already configured as a source and naming each that could
// not be parsed.
func (s *SecretService) FindDotenvFiles(folder string) (DotenvScanResult, error) {
	found, skipped, err := dotenvscan.Scan(expandUserHome(folder))
	if err != nil {
		return DotenvScanResult{}, err
	}
	existing := existingSourcePaths(s.sourcesSnapshot())
	out := DotenvScanResult{Found: make([]DotenvFound, 0, len(found)), Skipped: make([]DotenvSkipped, 0, len(skipped))}
	for _, f := range found {
		out.Found = append(out.Found, DotenvFound{
			RelPath: f.RelPath, Path: f.Path, Keys: f.Keys,
			AlreadySource: existing[cleanPath(f.Path)],
			Label:         dotenvscan.SourceLabel(folder, f), Tag: dotenvscan.ImportTag(folder, f),
		})
	}
	for _, sk := range skipped {
		out.Skipped = append(out.Skipped, DotenvSkipped{RelPath: sk.RelPath, Reason: sk.Reason})
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
// how many were added. A path already configured as a source is not
// added again -- the picker shows it disabled; this is the backstop
// for a call that came from anywhere else (goal 0367).
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
	for _, f := range found.Found {
		if !chosen[f.Path] || f.AlreadySource {
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
// tag, and the file it came from recorded on the entry. A locked vault
// is refused UP FRONT -- never after a partial import -- and a key a
// previous import of the same file already stored is updated in place,
// never appended a second time (goal 0367). Returns how many entries
// were written.
func (s *SecretService) ImportDotenvKeys(folder string, paths []string) (int, error) {
	if !s.vault.Unlocked() {
		return 0, ErrDotenvImportLocked
	}
	found, err := s.FindDotenvFiles(folder)
	if err != nil {
		return 0, err
	}
	// Index the vault's existing import records by (title, origin) so a
	// re-import of the same file finds its own entries back instead of
	// adding twins -- summaries carry no values, so nothing is revealed.
	summaries, err := s.vault.List()
	if err != nil {
		return 0, err
	}
	byTitleOrigin := make(map[string]string, len(summaries))
	for _, e := range summaries {
		if e.Origin == "" {
			continue
		}
		byTitleOrigin[importKey(e.Title, e.Origin)] = e.ID
	}
	chosen := chosenSet(paths)
	imported := 0
	for _, f := range found.Found {
		if !chosen[f.Path] {
			continue
		}
		values, err := dotenvsource.Read(f.Path)
		if err != nil {
			continue // the results view already named this file and why
		}
		for key, value := range values {
			e := secret.Entry{Title: key, Password: value, Kind: secret.KindText, Tags: []string{f.Tag}, Origin: "import:" + f.RelPath}
			if id, ok := byTitleOrigin[importKey(e.Title, e.Origin)]; ok {
				e.ID = id
			}
			created, err := s.vault.Upsert(e)
			if err != nil {
				if errors.Is(err, secret.ErrVaultLocked) {
					return imported, ErrDotenvImportLocked
				}
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

func importKey(title, origin string) string {
	return origin + "\x1f" + title
}

// existingSourcePaths indexes the configured sources by the normalized
// form of the path they point at, so a scan can mark "this file is
// already a source" however the path was written.
func existingSourcePaths(sources []secretsource.Source) map[string]bool {
	out := make(map[string]bool, len(sources))
	for _, src := range sources {
		if src.Kind != secretsource.KindEnv {
			continue
		}
		out[cleanPath(src.Path)] = true
	}
	return out
}

func cleanPath(path string) string {
	return filepath.Clean(expandUserHome(strings.TrimSpace(path)))
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
