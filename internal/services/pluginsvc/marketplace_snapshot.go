package pluginsvc

import (
	"context"
	"fmt"
	"os"
	"path/filepath"

	"github.com/alicoding/mill/internal/adapters/backup"
	"github.com/alicoding/mill/internal/adapters/pluginstate"
)

// SnapshotStoredState writes a validated, read-only source-state snapshot.
//
//wails:ignore
func SnapshotStoredState(pluginDir, destinationDirectory string) error {
	databasePath := pluginstate.Path(pluginDir)
	if _, err := os.Stat(databasePath); err == nil {
		present, err := snapshotCatalog(databasePath, destinationDirectory)
		if err != nil || present {
			return err
		}
	} else if !os.IsNotExist(err) {
		return fmt.Errorf("inspect extension source database: %w", err)
	}
	return snapshotLegacyState(pluginDir, destinationDirectory)
}

func snapshotCatalog(databasePath, destinationDirectory string) (bool, error) {
	if err := os.MkdirAll(destinationDirectory, 0o700); err != nil {
		return false, err
	}
	snapshotPath := filepath.Join(destinationDirectory, "catalog.sqlite")
	if err := backup.SnapshotSQLite(databasePath, snapshotPath); err != nil {
		return false, err
	}
	store := pluginstate.NewAt(snapshotPath)
	payload, _, present, loadErr := store.Load(context.Background())
	closeErr := store.Close()
	if loadErr != nil {
		return false, loadErr
	}
	if closeErr != nil {
		return false, closeErr
	}
	if !present {
		if err := os.Remove(snapshotPath); err != nil {
			return false, fmt.Errorf("remove empty extension source snapshot: %w", err)
		}
		return false, nil
	}
	if _, err := decodeMarketplaceState(payload); err != nil {
		return false, err
	}
	return true, nil
}

func snapshotLegacyState(pluginDir, destinationDirectory string) error {
	legacyPath := filepath.Join(pluginDir, marketplacesFile)
	raw, err := os.ReadFile(legacyPath) // #nosec G304 -- the resolved plugin profile path
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return fmt.Errorf("read legacy extension source state: %w", err)
	}
	if _, err := decodeLegacyMarketplaceState(raw); err != nil {
		return err
	}
	if err := os.MkdirAll(destinationDirectory, 0o700); err != nil {
		return err
	}
	// #nosec G703 -- destination is the backup adapter-owned participant directory with a fixed basename.
	return os.WriteFile(filepath.Join(destinationDirectory, "legacy-marketplaces.json"), raw, 0o600)
}

// ValidateStoredSnapshot validates one detached import artifact without
// opening or changing the live plugin profile.
//
//wails:ignore
func ValidateStoredSnapshot(databasePath string, legacyRaw []byte) error {
	if databasePath != "" {
		store := pluginstate.NewAt(databasePath)
		payload, _, present, loadErr := store.Load(context.Background())
		closeErr := store.Close()
		if loadErr != nil {
			return loadErr
		}
		if closeErr != nil {
			return closeErr
		}
		if !present {
			return fmt.Errorf("extension source snapshot has no catalog state")
		}
		_, err := decodeMarketplaceState(payload)
		return err
	}
	if legacyRaw != nil {
		_, err := decodeLegacyMarketplaceState(legacyRaw)
		return err
	}
	return fmt.Errorf("extension source snapshot is empty")
}

// CloseState settles current source-state work and refuses later mutations.
//
//wails:ignore
func (p *PluginService) CloseState() error { return p.state.Close() }
