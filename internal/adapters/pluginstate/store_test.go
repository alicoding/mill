package pluginstate

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/alicoding/mill/internal/adapters/backup"
)

func TestStoreMissingLoadDoesNotCreateState(t *testing.T) {
	dir := t.TempDir()
	store := New(dir)
	_, revision, present, err := store.Load(context.Background())
	if err != nil || present || revision != 0 {
		t.Fatalf("Load() = (_, %d, %v, %v)", revision, present, err)
	}
	if _, err := os.Stat(Path(dir)); !os.IsNotExist(err) {
		t.Fatalf("missing read created state: %v", err)
	}
}

func TestStoreRecognizesPristineSQLiteAndInitializesIt(t *testing.T) {
	dir := t.TempDir()
	db, err := sql.Open("sqlite", sqliteDSN(Path(dir)))
	if err != nil {
		t.Fatal(err)
	}
	if err := db.PingContext(context.Background()); err != nil {
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	store := New(dir)
	if _, _, present, err := store.Load(context.Background()); err != nil || present {
		t.Fatalf("pristine Load present=%v err=%v", present, err)
	}
	payload, revision, err := store.Update(context.Background(), func() ([]byte, error) { return []byte("seed"), nil }, func(current []byte) ([]byte, error) {
		return append(current, '!'), nil
	})
	if err != nil || revision != 1 || string(payload) != "seed!" {
		t.Fatalf("Update = %q, %d, %v", payload, revision, err)
	}
}

func TestStoreConcurrentInitializationAndUpdatesLoseNothing(t *testing.T) {
	dir := t.TempDir()
	first, second := New(dir), New(dir)
	var initializerCalls atomic.Int32
	const writes = 20
	var wg sync.WaitGroup
	start := make(chan struct{})
	for i := 0; i < writes; i++ {
		wg.Add(1)
		store := first
		if i%2 == 1 {
			store = second
		}
		go func() {
			defer wg.Done()
			<-start
			_, _, err := store.Update(context.Background(), func() ([]byte, error) {
				initializerCalls.Add(1)
				return []byte(strings.Repeat("0", writes)), nil
			}, func(current []byte) ([]byte, error) {
				for i := range current {
					if current[i] == '0' {
						current[i] = '1'
						return current, nil
					}
				}
				return nil, errors.New("all writes already applied")
			})
			if err != nil {
				t.Errorf("Update: %v", err)
			}
		}()
	}
	close(start)
	wg.Wait()
	payload, revision, present, err := first.Load(context.Background())
	if err != nil || !present || revision != writes || string(payload) != strings.Repeat("1", writes) {
		t.Fatalf("Load = %q, %d, %v, %v", payload, revision, present, err)
	}
	if initializerCalls.Load() != 1 {
		t.Fatalf("initializer called %d times", initializerCalls.Load())
	}
}

func TestStoreRollbackPreservesPriorPayload(t *testing.T) {
	store := New(t.TempDir())
	if _, _, err := store.Update(context.Background(), func() ([]byte, error) { return []byte("before"), nil }, func(current []byte) ([]byte, error) { return current, nil }); err != nil {
		t.Fatal(err)
	}
	if _, _, err := store.Update(context.Background(), nil, func([]byte) ([]byte, error) { return nil, errors.New("refused") }); err == nil {
		t.Fatal("Update succeeded")
	}
	payload, revision, present, err := store.Load(context.Background())
	if err != nil || !present || revision != 1 || string(payload) != "before" {
		t.Fatalf("Load = %q, %d, %v, %v", payload, revision, present, err)
	}
}

func TestStoreUpdateRefusesIncompleteVersionedSchemaBeforeCallbacks(t *testing.T) {
	tests := map[string][]string{
		"additional table": {
			catalogSchema,
			"CREATE TABLE unexpected(value TEXT)",
		},
		"altered catalog table": {
			"CREATE TABLE catalog_state(singleton INTEGER PRIMARY KEY CHECK(singleton=1), revision INTEGER NOT NULL, payload BLOB NOT NULL, extra TEXT)",
		},
		"additional view": {
			catalogSchema,
			"CREATE VIEW catalog_view AS SELECT revision FROM catalog_state",
		},
		"additional index": {
			catalogSchema,
			"CREATE INDEX catalog_revision ON catalog_state(revision)",
		},
		"additional trigger": {
			catalogSchema,
			"CREATE TRIGGER catalog_write AFTER UPDATE ON catalog_state BEGIN SELECT RAISE(ABORT, 'trigger fired'); END",
		},
	}
	for name, definitions := range tests {
		t.Run(name, func(t *testing.T) {
			path := Path(t.TempDir())
			db, err := sql.Open("sqlite", sqliteDSN(path))
			if err != nil {
				t.Fatal(err)
			}
			for _, definition := range definitions {
				if _, err := db.ExecContext(context.Background(), definition); err != nil {
					t.Fatal(err)
				}
			}
			if _, err := db.ExecContext(context.Background(), "PRAGMA user_version=1"); err != nil {
				t.Fatal(err)
			}
			if _, err := db.ExecContext(context.Background(), "INSERT INTO catalog_state(singleton, revision, payload) VALUES(1, 7, ?)", []byte("before")); err != nil {
				t.Fatal(err)
			}
			before := schemaState(t, db)
			if err := db.Close(); err != nil {
				t.Fatal(err)
			}

			initializerCalls, changeCalls := 0, 0
			store := NewAt(path)
			_, _, err = store.Update(context.Background(), func() ([]byte, error) {
				initializerCalls++
				return []byte("seed"), nil
			}, func([]byte) ([]byte, error) {
				changeCalls++
				return []byte("after"), nil
			})
			if err == nil {
				t.Fatal("Update succeeded")
			}
			if initializerCalls != 0 || changeCalls != 0 {
				t.Fatalf("callbacks = initializer %d, change %d", initializerCalls, changeCalls)
			}
			if err := store.Close(); err != nil {
				t.Fatal(err)
			}
			reader := NewAt(path)
			if _, _, _, err := reader.Load(context.Background()); err == nil {
				t.Fatal("Load succeeded")
			}
			if err := reader.Close(); err != nil {
				t.Fatal(err)
			}
			snapshotPath := filepath.Join(t.TempDir(), "catalog.sqlite")
			if err := backup.SnapshotSQLite(path, snapshotPath); err != nil {
				t.Fatal(err)
			}
			snapshot := NewAt(snapshotPath)
			if _, _, _, err := snapshot.Load(context.Background()); err == nil {
				t.Fatal("detached snapshot validation succeeded")
			}
			if err := snapshot.Close(); err != nil {
				t.Fatal(err)
			}

			db, err = sql.Open("sqlite", sqliteDSN(path))
			if err != nil {
				t.Fatal(err)
			}
			defer func() { _ = db.Close() }()
			if after := schemaState(t, db); after != before {
				t.Fatalf("database changed\nbefore: %s\nafter:  %s", before, after)
			}
		})
	}
}

func schemaState(t *testing.T, db *sql.DB) string {
	t.Helper()
	rows, err := db.QueryContext(context.Background(), "SELECT type, name, tbl_name, coalesce(sql, '') FROM sqlite_schema ORDER BY type, name")
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = rows.Close() }()
	var state strings.Builder
	for rows.Next() {
		var objectType, name, table, definition string
		if err := rows.Scan(&objectType, &name, &table, &definition); err != nil {
			t.Fatal(err)
		}
		fmt.Fprintf(&state, "%s|%s|%s|%s\n", objectType, name, table, definition)
	}
	var revision int
	var payload []byte
	if err := db.QueryRowContext(context.Background(), "SELECT revision, payload FROM catalog_state WHERE singleton=1").Scan(&revision, &payload); err != nil {
		t.Fatal(err)
	}
	fmt.Fprintf(&state, "row|%d|%s", revision, payload)
	return state.String()
}

func TestStoreRefusesUnknownAndCorruptDatabasesWithoutChangingBytes(t *testing.T) {
	t.Run("future schema", func(t *testing.T) {
		dir := t.TempDir()
		db, err := sql.Open("sqlite", sqliteDSN(Path(dir)))
		if err != nil {
			t.Fatal(err)
		}
		if _, err := db.ExecContext(context.Background(), "PRAGMA user_version=99"); err != nil {
			t.Fatal(err)
		}
		if err := db.Close(); err != nil {
			t.Fatal(err)
		}
		before, _ := os.ReadFile(Path(dir))
		if _, _, _, err := New(dir).Load(context.Background()); err == nil || !strings.Contains(err.Error(), "schema 99") {
			t.Fatalf("Load error = %v", err)
		}
		after, _ := os.ReadFile(Path(dir))
		if string(after) != string(before) {
			t.Fatal("future database changed")
		}
	})
	t.Run("corrupt", func(t *testing.T) {
		dir := t.TempDir()
		if err := os.WriteFile(Path(dir), []byte("not sqlite"), 0o600); err != nil {
			t.Fatal(err)
		}
		if _, _, _, err := New(dir).Load(context.Background()); err == nil {
			t.Fatal("Load succeeded")
		}
		after, _ := os.ReadFile(Path(dir))
		if string(after) != "not sqlite" {
			t.Fatalf("corrupt bytes changed to %q", after)
		}
	})
}

func TestStoreCommitReadbackClassifiesIntendedPriorAndInterveningState(t *testing.T) {
	store := New(t.TempDir())
	if _, _, err := store.Update(context.Background(), func() ([]byte, error) { return []byte("prior"), nil }, func(current []byte) ([]byte, error) { return current, nil }); err != nil {
		t.Fatal(err)
	}
	commitErr := errors.New("injected commit acknowledgement failure")
	if _, _, err := store.resolveCommit(context.Background(), []byte("prior"), 1, nil, 0, false, commitErr); err != nil {
		t.Fatalf("intended readback: %v", err)
	}
	if _, _, err := store.resolveCommit(context.Background(), []byte("intended"), 2, []byte("prior"), 1, true, commitErr); err == nil || strings.Contains(err.Error(), "uncertain") {
		t.Fatalf("prior readback: %v", err)
	}
	if _, _, err := store.Update(context.Background(), nil, func([]byte) ([]byte, error) { return []byte("intervening"), nil }); err != nil {
		t.Fatal(err)
	}
	if _, _, err := store.resolveCommit(context.Background(), []byte("intended"), 2, []byte("prior"), 1, true, commitErr); err == nil || !strings.Contains(err.Error(), "uncertain") {
		t.Fatalf("intervening readback: %v", err)
	}
}

func TestStoreCloseWaitsForOperationAndRefusesReopen(t *testing.T) {
	store := New(t.TempDir())
	entered, release, updated := make(chan struct{}), make(chan struct{}), make(chan error, 1)
	go func() {
		_, _, err := store.Update(context.Background(), func() ([]byte, error) { return []byte("seed"), nil }, func(current []byte) ([]byte, error) {
			close(entered)
			<-release
			return current, nil
		})
		updated <- err
	}()
	<-entered
	closed := make(chan error, 1)
	go func() { closed <- store.Close() }()
	select {
	case err := <-closed:
		t.Fatalf("Close returned before operation settled: %v", err)
	default:
	}
	close(release)
	if err := <-updated; err != nil {
		t.Fatal(err)
	}
	if err := <-closed; err != nil {
		t.Fatal(err)
	}
	if _, _, _, err := store.Load(context.Background()); err == nil || !strings.Contains(err.Error(), "closed") {
		t.Fatalf("Load after Close = %v", err)
	}
}

func TestSQLiteDSNEscapesProfilesAndWindowsDrivePaths(t *testing.T) {
	local := filepath.Join(t.TempDir(), "profile # one?.sqlite")
	localPath, localHost := sqliteURIPath(local)
	tests := []struct {
		path, wantHost, wantPath string
	}{
		{local, localHost, localPath},
		{`C:\Users\Ali\Mill Profile#1?\.plugin-state.sqlite`, "", `/C:/Users/Ali/Mill Profile#1?/.plugin-state.sqlite`},
		{`\\server\share\Mill Profile\.plugin-state.sqlite`, "server", `/share/Mill Profile/.plugin-state.sqlite`},
	}
	for i, test := range tests {
		parsed, err := url.Parse(sqliteDSN(test.path))
		if err != nil {
			t.Fatal(err)
		}
		if parsed.Host != test.wantHost {
			t.Errorf("case %d host=%q", i, parsed.Host)
		}
		if parsed.Path != test.wantPath {
			t.Errorf("case %d path=%q want %q", i, parsed.Path, test.wantPath)
		}
		if strings.Contains(parsed.RawPath, "#") || strings.Contains(parsed.RawPath, "?") {
			t.Errorf("case %d raw path not escaped: %q", i, parsed.RawPath)
		}
	}
}

func TestStoreSpecialCharacterProfileReopensAndSnapshots(t *testing.T) {
	profile := filepath.Join(t.TempDir(), "Mill Profile #1% 雪")
	store := New(profile)
	payload := []byte(`{"source":"kept"}`)
	if _, _, err := store.Update(context.Background(), func() ([]byte, error) { return payload, nil }, func(current []byte) ([]byte, error) { return current, nil }); err != nil {
		t.Fatal(err)
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}
	reopened := New(profile)
	got, revision, present, err := reopened.Load(context.Background())
	if err != nil || !present || revision != 1 || string(got) != string(payload) {
		t.Fatalf("reopen = %q, %d, %v, %v", got, revision, present, err)
	}
	if err := reopened.Close(); err != nil {
		t.Fatal(err)
	}
	snapshot := filepath.Join(t.TempDir(), "snapshot #1% 雪.sqlite")
	if err := backup.SnapshotSQLite(Path(profile), snapshot); err != nil {
		t.Fatal(err)
	}
	snapshotStore := NewAt(snapshot)
	got, revision, present, err = snapshotStore.Load(context.Background())
	if err != nil || !present || revision != 1 || string(got) != string(payload) {
		t.Fatalf("snapshot = %q, %d, %v, %v", got, revision, present, err)
	}
	if err := snapshotStore.Close(); err != nil {
		t.Fatal(err)
	}
}
