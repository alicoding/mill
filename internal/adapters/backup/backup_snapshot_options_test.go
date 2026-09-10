package backup

import (
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestSnapshotUsesSettingsReaderAndParticipantBeforePublication(t *testing.T) {
	dbPath := newTestDB(t)
	dir := t.TempDir()
	result, err := Snapshot(dbPath, filepath.Join(t.TempDir(), "ignored.json"), "", dir, 3, SnapshotOptions{
		ReadSettings: func() ([]byte, error) { return []byte(`{"live":true}`), nil },
		Participants: []Participant{{Name: "plugin-state", Write: func(destination string) error {
			return os.WriteFile(filepath.Join(destination, "catalog.sqlite"), []byte("catalog"), 0o600)
		}}},
	})
	if err != nil {
		t.Fatal(err)
	}
	settings, err := os.ReadFile(filepath.Join(result.Dir, "settings.json"))
	if err != nil || string(settings) != `{"live":true}` {
		t.Fatalf("settings = %q, %v", settings, err)
	}
	pluginState, err := os.ReadFile(filepath.Join(result.Dir, "plugin-state", "catalog.sqlite"))
	if err != nil || string(pluginState) != "catalog" {
		t.Fatalf("participant = %q, %v", pluginState, err)
	}
}

func TestSnapshotParticipantFailureDoesNotPublishOrPrune(t *testing.T) {
	dbPath := newTestDB(t)
	dir := t.TempDir()
	older, err := Snapshot(dbPath, "", "", dir, 1)
	if err != nil {
		t.Fatal(err)
	}
	time.Sleep(2 * time.Millisecond)
	_, err = Snapshot(dbPath, "", "", dir, 1, SnapshotOptions{Participants: []Participant{{Name: "plugin-state", Write: func(string) error {
		return fmt.Errorf("injected participant failure")
	}}}})
	if err == nil || !strings.Contains(err.Error(), "injected participant failure") {
		t.Fatalf("Snapshot error = %v", err)
	}
	names, err := backupDirNames(dir)
	if err != nil || len(names) != 1 || filepath.Join(dir, names[0]) != older.Dir {
		t.Fatalf("completed backups = %v, %v", names, err)
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range entries {
		if strings.HasPrefix(entry.Name(), ".incomplete-") {
			t.Fatalf("unfinished attempt retained: %s", entry.Name())
		}
	}
}

func TestSQLiteFileDSNEscapesWindowsDrivePath(t *testing.T) {
	dsn := sqliteFileDSN(`C:\Users\Ali\Mill Profile#1?\execution.db`)
	parsed, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	if parsed.Host != "" || parsed.Path != `/C:/Users/Ali/Mill Profile#1?/execution.db` {
		t.Fatalf("parsed SQLite URI host=%q path=%q (%s)", parsed.Host, parsed.Path, dsn)
	}
	if !strings.Contains(dsn, "%23") || !strings.Contains(dsn, "%3F") {
		t.Fatalf("SQLite URI does not escape reserved path bytes: %s", dsn)
	}
}
