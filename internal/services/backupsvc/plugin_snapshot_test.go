package backupsvc

import (
	"archive/zip"
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/alicoding/mill/internal/adapters/backup"
	"github.com/alicoding/mill/internal/services/pluginsvc"
)

func pluginStateParticipant(write func(string) error) backup.SnapshotOptions {
	return backup.SnapshotOptions{Participants: []backup.Participant{{Name: "plugin-state", Write: write}}}
}

func closeTestPluginServiceState(t *testing.T, service *pluginsvc.PluginService) {
	t.Helper()
	t.Cleanup(func() {
		if err := service.CloseState(); err != nil {
			t.Errorf("CloseState: %v", err)
		}
	})
}

func TestBackupServicePassesPluginStateParticipantToEveryBackupDoor(t *testing.T) {
	_, _, dbPath := newTestExecutionHarness(t)
	var calls atomic.Int32
	options := pluginStateParticipant(func(destination string) error {
		calls.Add(1)
		return os.WriteFile(filepath.Join(destination, "legacy-marketplaces.json"), []byte(`{"sources":[]}`), 0o600)
	})
	for name, invoke := range map[string]func(*BackupService) error{
		"on demand":       func(service *BackupService) error { _, err := service.BackupNow(2); return err },
		"workflow runner": func(service *BackupService) error { _, err := service.BackupRunner()(2); return err },
		"clean shutdown":  func(service *BackupService) error { return service.BackupOnCleanShutdown() },
	} {
		t.Run(name, func(t *testing.T) {
			service := New(dbPath, "", "", t.TempDir(), "test", options)
			if err := invoke(service); err != nil {
				t.Fatal(err)
			}
		})
	}
	if calls.Load() != 3 {
		t.Fatalf("participant called %d times", calls.Load())
	}
}

func TestExportEverythingIncludesPluginStateWithoutSQLiteExecutionDB(t *testing.T) {
	options := pluginStateParticipant(func(destination string) error {
		return os.WriteFile(filepath.Join(destination, "legacy-marketplaces.json"), []byte(`{"sources":[]}`), 0o600)
	})
	service := New("", "", "", t.TempDir(), "test", options)
	archive, err := service.ExportEverything()
	if err != nil {
		t.Fatal(err)
	}
	preview, err := service.PreviewImportEverything(archive)
	if err != nil {
		t.Fatal(err)
	}
	if !preview.PluginStateSnapshotPresent || preview.SnapshotPresent {
		t.Fatalf("preview = %+v", preview)
	}
	summary, err := service.ImportEverything(archive)
	if err != nil || !summary.PluginStateSnapshotPresent {
		t.Fatalf("import = %+v, %v", summary, err)
	}
}

func TestImportEverythingReportsButDoesNotApplyValidPluginStateSnapshot(t *testing.T) {
	archiveState := `{"sources":[{"name":"archive-source","kind":"path","locator":"/archive/source","ref":""}]}`
	exporter := New("", "", "", t.TempDir(), "test", pluginStateParticipant(func(destination string) error {
		return os.WriteFile(filepath.Join(destination, "legacy-marketplaces.json"), []byte(archiveState), 0o600)
	}))
	archive, err := exporter.ExportEverything()
	if err != nil {
		t.Fatal(err)
	}

	profileDir := t.TempDir()
	settingsPath := filepath.Join(profileDir, "settings.json")
	pluginDir := pluginsvc.ResolveDir(settingsPath)
	liveIndexDir := filepath.Join(t.TempDir(), "live-index")
	if err := os.MkdirAll(filepath.Join(liveIndexDir, ".mill"), 0o750); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(liveIndexDir, ".mill", "marketplace.json"), []byte(`{"name":"live-source","owner":{"name":"Live owner"},"plugins":[]}`), 0o600); err != nil {
		t.Fatal(err)
	}
	liveService := pluginsvc.New(pluginDir, nil, "test")
	closeTestPluginServiceState(t, liveService)
	added, err := liveService.AddMarketplaceSource(liveIndexDir)
	if err != nil {
		t.Fatal(err)
	}
	if err := liveService.CloseState(); err != nil {
		t.Fatal(err)
	}
	livePath := filepath.Join(pluginDir, ".plugin-state.sqlite")
	before, err := os.ReadFile(livePath) // #nosec G304 -- test-owned temporary profile path
	if err != nil {
		t.Fatal(err)
	}
	summary, err := New("", settingsPath, "", t.TempDir(), "test").ImportEverything(archive)
	if err != nil {
		t.Fatal(err)
	}
	if !summary.PluginStateSnapshotPresent {
		t.Fatalf("import summary = %+v", summary)
	}
	after, err := os.ReadFile(livePath) // #nosec G304 -- test-owned temporary profile path
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(after, before) {
		t.Fatal("live source catalog bytes changed")
	}
	reopened := pluginsvc.New(pluginDir, nil, "test")
	closeTestPluginServiceState(t, reopened)
	sources, err := reopened.ListMarketplaceSources()
	if err != nil {
		t.Fatal(err)
	}
	if err := reopened.CloseState(); err != nil {
		t.Fatal(err)
	}
	if len(sources) != 2 || sources[1].Name != added.Name || sources[1].Incarnation != added.Incarnation {
		t.Fatalf("live source identity changed: added=%+v sources=%+v", added, sources)
	}
}

func TestPluginStateSnapshotValidationPrecedesEntityMutation(t *testing.T) {
	archive := testArchive(t, map[string]string{
		"workflows/item.json":                     `{"schemaVersion":1,"item":{"ID":"item"}}`,
		"db-snapshot/plugin-state/catalog.sqlite": "not sqlite",
	})
	service := New("", "", "", t.TempDir(), "test")
	var imports atomic.Int32
	service.SetFamilies([]FamilyBundle{{
		Name:   "workflows",
		IDs:    func() []string { return nil },
		Import: func(string) (string, error) { imports.Add(1); return "item", nil },
	}})
	if _, err := service.PreviewImportEverything(archive); err == nil || !strings.Contains(err.Error(), "invalid extension source snapshot") {
		t.Fatalf("Preview error = %v", err)
	}
	if _, err := service.ImportEverything(archive); err == nil || !strings.Contains(err.Error(), "invalid extension source snapshot") {
		t.Fatalf("Import error = %v", err)
	}
	if imports.Load() != 0 {
		t.Fatalf("corrupt snapshot applied %d entities", imports.Load())
	}
}

func TestPluginStateSnapshotRejectsConflictingAndUnknownEntries(t *testing.T) {
	for name, files := range map[string]map[string]string{
		"conflicting": {
			"db-snapshot/plugin-state/catalog.sqlite":           "not sqlite",
			"db-snapshot/plugin-state/legacy-marketplaces.json": `{"sources":[]}`,
		},
		"unknown": {"db-snapshot/plugin-state/other.json": `{}`},
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := New("", "", "", t.TempDir(), "test").PreviewImportEverything(testArchive(t, files)); err == nil {
				t.Fatal("Preview succeeded")
			}
		})
	}
}

func TestVersionChangeParticipantFailureDoesNotAdvanceStamp(t *testing.T) {
	store := &testSettingsStore{values: map[string]any{lastSeenVersionKey: "old"}}
	options := pluginStateParticipant(func(string) error { return errors.New("injected plugin snapshot failure") })
	didBackup, err := SnapshotOnVersionChange(store, "", "", "", t.TempDir(), "new", options)
	if err == nil || didBackup || store.values[lastSeenVersionKey] != "old" {
		t.Fatalf("SnapshotOnVersionChange = %v, %v, stamp=%v", didBackup, err, store.values[lastSeenVersionKey])
	}
}

type testSettingsStore struct{ values map[string]any }

func (s *testSettingsStore) Get(key string) any              { return s.values[key] }
func (s *testSettingsStore) Set(key string, value any) error { s.values[key] = value; return nil }

func testArchive(t *testing.T, files map[string]string) string {
	t.Helper()
	var output bytes.Buffer
	writer := zip.NewWriter(&output)
	manifestBytes, err := json.Marshal(manifest{Schema: manifestSchema, MillVersion: "test", TakenAt: time.Now()})
	if err != nil {
		t.Fatal(err)
	}
	if err := writeZipFile(writer, "manifest.json", string(manifestBytes)); err != nil {
		t.Fatal(err)
	}
	for name, body := range files {
		if err := writeZipFile(writer, name, body); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	return base64.StdEncoding.EncodeToString(output.Bytes())
}
