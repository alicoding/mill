package wiring

import (
	"context"
	"database/sql"
	"encoding/json"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"testing"

	backupadapter "github.com/alicoding/mill/internal/adapters/backup"
	"github.com/alicoding/mill/internal/adapters/pluginstate"
	"github.com/alicoding/mill/internal/services/backupsvc"
	"github.com/alicoding/mill/internal/services/mcpsvc"
	"github.com/alicoding/mill/internal/services/pluginsvc"
)

func TestShutdownSnapshotServicesBacksUpLivePluginStateBeforeClosing(t *testing.T) {
	settingsPath := filepath.Join(t.TempDir(), "settings.json")
	pluginDir := pluginsvc.ResolveDir(settingsPath)
	pluginService := pluginsvc.New(pluginDir, nil, "test")
	t.Cleanup(func() {
		if err := pluginService.CloseState(); err != nil {
			t.Errorf("CloseState cleanup: %v", err)
		}
	})

	sourceDir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(sourceDir, ".mill"), 0o750); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(sourceDir, ".mill", "marketplace.json"), []byte(`{"name":"shutdown-source","owner":{"name":"Test owner"},"plugins":[]}`), 0o600); err != nil {
		t.Fatal(err)
	}
	source, err := pluginService.AddMarketplaceSource(sourceDir)
	if err != nil {
		t.Fatal(err)
	}

	dbPath := filepath.Join(t.TempDir(), "execution.db")
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(t.Context(), `CREATE TABLE shutdown_snapshot_probe (id INTEGER PRIMARY KEY)`); err != nil {
		_ = db.Close()
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}

	participantSawOpenState := false
	backupDir := t.TempDir()
	backupService := backupsvc.New(dbPath, settingsPath, "", backupDir, "test", backupadapter.SnapshotOptions{
		ReadSettings: func() ([]byte, error) { return []byte(`{"profile":"shutdown"}`), nil },
		Participants: []backupadapter.Participant{{Name: "plugin-state", Write: func(destination string) error {
			_, readErr := pluginService.ListMarketplaceSources()
			participantSawOpenState = readErr == nil
			return pluginsvc.SnapshotStoredState(pluginDir, destination)
		}}},
	})
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	shutdownSnapshotServices(logger, backupService, &mcpsvc.MillMCPService{}, pluginService)

	if !participantSawOpenState {
		t.Fatal("shutdown snapshot participant did not observe live plugin state")
	}
	if _, err := pluginService.ListMarketplaceSources(); err == nil {
		t.Fatal("plugin state remained readable after shutdown")
	}

	entries, err := os.ReadDir(backupDir)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 || !entries[0].IsDir() {
		t.Fatalf("backup entries = %+v", entries)
	}
	snapshotPath := filepath.Join(backupDir, entries[0].Name(), "plugin-state", "catalog.sqlite")
	store := pluginstate.NewAt(snapshotPath)
	payload, _, present, loadErr := store.Load(context.Background())
	closeErr := store.Close()
	if loadErr != nil {
		t.Fatal(loadErr)
	}
	if closeErr != nil {
		t.Fatal(closeErr)
	}
	if !present {
		t.Fatal("shutdown backup has no plugin catalog")
	}
	var catalog struct {
		Sources []struct {
			Name        string `json:"name"`
			Incarnation string `json:"incarnation"`
		} `json:"sources"`
	}
	if err := json.Unmarshal(payload, &catalog); err != nil {
		t.Fatal(err)
	}
	if len(catalog.Sources) != 1 || catalog.Sources[0].Name != source.Name || catalog.Sources[0].Incarnation != source.Incarnation {
		t.Fatalf("shutdown backup sources = %+v, added = %+v", catalog.Sources, source)
	}
}
