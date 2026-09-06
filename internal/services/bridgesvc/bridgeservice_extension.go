package bridgesvc

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"

	"github.com/alicoding/mill/internal/adapters/osopen"
)

// The extension's own files ship inside the binary, and are written to
// a real folder on first ask: a browser loads an unpacked extension
// from a DIRECTORY, so there has to be one, and an installed copy of
// Mill has no source tree to point at.
//
// The folder is Mill's to own, not the user's to edit -- every file is
// rewritten from the binary on each reveal, so a Mill upgrade cannot
// leave a stale extension loaded in someone's browser.

// extensionDirName is the folder the extension is written into, beside
// the settings file, the same place plugins are installed.
const extensionDirName = "browser-extension"

// SetExtensionBundle hands the service the extension's files and the
// folder to write them into. Called once at wiring time; without it,
// revealing the folder reports that this build carries no extension
// rather than creating an empty directory.
//
//wails:ignore
func (s *BridgeService) SetExtensionBundle(files fs.FS, parentDir string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.extensionFiles = files
	s.extensionDir = filepath.Join(parentDir, extensionDirName)
}

// ExtensionFolder writes the extension out of the binary and returns
// the folder to load into a browser. Safe to call repeatedly: it
// rewrites what it already wrote.
func (s *BridgeService) ExtensionFolder() (string, error) {
	s.mu.Lock()
	files, dir := s.extensionFiles, s.extensionDir
	s.mu.Unlock()
	if files == nil || dir == "" {
		return "", errNoExtensionBundle()
	}
	if err := writeTree(files, dir); err != nil {
		return "", err
	}
	return dir, nil
}

// RevealExtensionFolder writes the extension out and opens its folder
// in the file manager, ALWAYS returning the path: a browser's
// "Load unpacked" dialog needs it typed or pasted, and server mode has
// no file manager to open at all.
func (s *BridgeService) RevealExtensionFolder() (string, error) {
	dir, err := s.ExtensionFolder()
	if err != nil {
		return "", err
	}
	if err := osopen.Open(dir); err != nil && !errors.Is(err, osopen.ErrUnsupportedInServerMode) {
		s.logger.Info("browser bridge: opening the extension folder", "error", err)
	}
	return dir, nil
}

// errNoExtensionBundle is the failure for a build carrying no embedded
// extension -- a wiring fault, phrased for the reader who hits it.
func errNoExtensionBundle() error {
	return fmt.Errorf("bridgesvc: this build carries no browser extension")
}

// writeTree copies every embedded file into dir, creating directories
// as it goes and overwriting whatever is already there.
func writeTree(files fs.FS, dir string) error {
	return fs.WalkDir(files, ".", func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		target := filepath.Join(dir, filepath.FromSlash(path))
		if entry.IsDir() {
			return os.MkdirAll(target, 0o750)
		}
		body, err := fs.ReadFile(files, path)
		if err != nil {
			return fmt.Errorf("bridgesvc: reading the bundled extension: %w", err)
		}
		if err := os.MkdirAll(filepath.Dir(target), 0o750); err != nil {
			return fmt.Errorf("bridgesvc: creating the extension folder: %w", err)
		}
		if err := os.WriteFile(target, body, 0o600); err != nil {
			return fmt.Errorf("bridgesvc: writing the extension: %w", err)
		}
		return nil
	})
}
