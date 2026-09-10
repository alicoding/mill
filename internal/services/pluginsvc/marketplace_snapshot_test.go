package pluginsvc

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"testing"

	"github.com/alicoding/mill/internal/adapters/pluginstate"
)

func TestSnapshotStoredStateHandlesAbsentAndExactLegacyBytes(t *testing.T) {
	pluginDir := t.TempDir()
	absentDestination := t.TempDir()
	if err := SnapshotStoredState(pluginDir, absentDestination); err != nil {
		t.Fatal(err)
	}
	entries, err := os.ReadDir(absentDestination)
	if err != nil || len(entries) != 0 {
		t.Fatalf("absent snapshot entries = %v, %v", entries, err)
	}
	legacy := []byte("{\n  \"sources\": []\n}\n")
	if err := os.WriteFile(filepath.Join(pluginDir, marketplacesFile), legacy, 0o600); err != nil {
		t.Fatal(err)
	}
	destination := t.TempDir()
	if err := SnapshotStoredState(pluginDir, destination); err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(filepath.Join(destination, "legacy-marketplaces.json")) // #nosec G304 -- test-owned temporary path
	if err != nil || string(got) != string(legacy) {
		t.Fatalf("legacy snapshot = %q, %v", got, err)
	}
}

func TestSnapshotStoredStateFallsBackToLegacyAfterFailedFirstMutation(t *testing.T) {
	pluginDir := t.TempDir()
	store := pluginstate.New(pluginDir)
	_, _, err := store.Update(context.Background(), func() ([]byte, error) {
		return nil, errors.New("injected first mutation failure")
	}, func(current []byte) ([]byte, error) { return current, nil })
	if err == nil {
		t.Fatal("Update succeeded")
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}
	legacy := []byte("{\n  \"sources\": []\n}\n")
	if err := os.WriteFile(filepath.Join(pluginDir, marketplacesFile), legacy, 0o600); err != nil {
		t.Fatal(err)
	}
	destination := t.TempDir()
	if err := SnapshotStoredState(pluginDir, destination); err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(filepath.Join(destination, "legacy-marketplaces.json")) // #nosec G304 -- test-owned temporary path
	if err != nil || string(got) != string(legacy) {
		t.Fatalf("legacy snapshot = %q, %v", got, err)
	}
	if _, err := os.Stat(filepath.Join(destination, "catalog.sqlite")); !os.IsNotExist(err) {
		t.Fatalf("empty catalog snapshot remains: %v", err)
	}
}

func TestSnapshotStoredStatePristineDatabaseStillRefusesMalformedLegacy(t *testing.T) {
	pluginDir := t.TempDir()
	store := pluginstate.New(pluginDir)
	_, _, _ = store.Update(context.Background(), func() ([]byte, error) {
		return nil, errors.New("injected first mutation failure")
	}, func(current []byte) ([]byte, error) { return current, nil })
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(pluginDir, marketplacesFile), []byte("{"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := SnapshotStoredState(pluginDir, t.TempDir()); err == nil {
		t.Fatal("SnapshotStoredState succeeded")
	}
}

func TestSnapshotStoredStateCommittedCatalogTakesPrecedenceOverLegacy(t *testing.T) {
	svc, pluginDir := newStoreService(t)
	if _, err := svc.mutateState(func(state *marketplaceState) error {
		state.Updates.CheckedAt = "catalog-wins"
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(pluginDir, marketplacesFile), []byte("{"), 0o600); err != nil {
		t.Fatal(err)
	}
	destination := t.TempDir()
	if err := SnapshotStoredState(pluginDir, destination); err != nil {
		t.Fatal(err)
	}
	if err := ValidateStoredSnapshot(filepath.Join(destination, "catalog.sqlite"), nil); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(destination, "legacy-marketplaces.json")); !os.IsNotExist(err) {
		t.Fatalf("legacy snapshot written: %v", err)
	}
}

func TestSnapshotStoredStateRejectsMalformedLegacyAndDatabase(t *testing.T) {
	for name, prepare := range map[string]func(string) error{
		"legacy":   func(dir string) error { return os.WriteFile(filepath.Join(dir, marketplacesFile), []byte("{"), 0o600) },
		"database": func(dir string) error { return os.WriteFile(pluginstate.Path(dir), []byte("not sqlite"), 0o600) },
	} {
		t.Run(name, func(t *testing.T) {
			dir := t.TempDir()
			if err := prepare(dir); err != nil {
				t.Fatal(err)
			}
			if err := SnapshotStoredState(dir, t.TempDir()); err == nil {
				t.Fatal("SnapshotStoredState succeeded")
			}
		})
	}
}

func TestSnapshotStoredStateValidatesDetachedSQLiteWhileWritesContinue(t *testing.T) {
	svc, dir := newStoreService(t)
	if _, err := svc.mutateState(func(state *marketplaceState) error {
		state.Updates.CheckedAt = "seed"
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	start := make(chan struct{})
	var wg sync.WaitGroup
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			for j := 0; j < 10; j++ {
				if _, err := svc.mutateState(func(state *marketplaceState) error {
					state.Updates.Problems = append(state.Updates.Problems, "write")
					return nil
				}); err != nil {
					t.Errorf("mutateState: %v", err)
					return
				}
			}
		}()
	}
	close(start)
	destination := t.TempDir()
	if err := SnapshotStoredState(dir, destination); err != nil {
		t.Fatal(err)
	}
	wg.Wait()
	path := filepath.Join(destination, "catalog.sqlite")
	if err := ValidateStoredSnapshot(path, nil); err != nil {
		t.Fatalf("ValidateStoredSnapshot: %v", err)
	}
	store := pluginstate.NewAt(path)
	payload, _, present, err := store.Load(context.Background())
	if err != nil || !present {
		t.Fatalf("snapshot Load present=%v err=%v", present, err)
	}
	if _, err := decodeMarketplaceState(payload); err != nil {
		t.Fatal(err)
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}
}
