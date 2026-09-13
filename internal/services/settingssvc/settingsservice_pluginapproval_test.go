package settingssvc

import (
	"errors"
	"log/slog"
	"os"
	"reflect"
	"sync"
	"testing"

	"github.com/alicoding/mill/internal/services/compositionsvc"
	"github.com/alicoding/mill/internal/services/servicetest"
	"github.com/alicoding/mill/internal/services/triggersvc"
)

type persistedApprovalMemory struct {
	mu        sync.Mutex
	payload   []byte
	revision  int64
	updateErr error
}

func (m *persistedApprovalMemory) wire(service *SettingsService) {
	SetPluginApprovalStore(service,
		func() ([]byte, int64, bool, error) {
			m.mu.Lock()
			defer m.mu.Unlock()
			return append([]byte(nil), m.payload...), m.revision, m.payload != nil, nil
		},
		func(initializer PluginApprovalInitializer, change PluginApprovalChange) ([]byte, int64, error) {
			m.mu.Lock()
			defer m.mu.Unlock()
			if m.updateErr != nil {
				return nil, 0, m.updateErr
			}
			current := append([]byte(nil), m.payload...)
			if current == nil {
				var err error
				current, err = initializer()
				if err != nil {
					return nil, 0, err
				}
			}
			next, err := change(current)
			if err != nil {
				return nil, 0, err
			}
			m.revision++
			m.payload = append([]byte(nil), next...)
			return append([]byte(nil), m.payload...), m.revision, nil
		},
	)
}

func TestPluginApprovalMigrationMarksOnlyExplicitLegacyAllowedWithoutLocks(t *testing.T) {
	store := servicetest.NewFakeStore()
	if err := store.Set(allowedPluginsKey, `["mill-a","mill-b"]`); err != nil {
		t.Fatal(err)
	}
	if err := store.Set(pluginLockKey, `{"mill-b":{"version":"1.0.0","hash":"sha256-b"}}`); err != nil {
		t.Fatal(err)
	}
	service := settingsServiceForApprovalTest(store)
	wireApprovalMemory(service)
	snapshot, err := ReadPluginApprovalSnapshot(service)
	if err != nil {
		t.Fatal(err)
	}
	if !snapshot.Initialized || !reflect.DeepEqual(snapshot.Allowed, []string{"mill-a", "mill-b"}) || !reflect.DeepEqual(snapshot.LegacyUnpinned, []string{"mill-a"}) {
		t.Fatalf("migrated snapshot = %+v", snapshot)
	}
	if snapshot.Locks["mill-b"].Hash != "sha256-b" {
		t.Fatalf("migrated lock = %+v", snapshot.Locks["mill-b"])
	}
}

func TestPluginApprovalMigrationDistinguishesAbsentAndExplicitEmptyAllowed(t *testing.T) {
	for _, test := range []struct {
		name        string
		seedAllowed bool
		initialized bool
	}{
		{name: "absent", initialized: false},
		{name: "explicit empty", seedAllowed: true, initialized: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			store := servicetest.NewFakeStore()
			if test.seedAllowed {
				if err := store.Set(allowedPluginsKey, `[]`); err != nil {
					t.Fatal(err)
				}
			}
			service := settingsServiceForApprovalTest(store)
			wireApprovalMemory(service)
			snapshot, err := ReadPluginApprovalSnapshot(service)
			if err != nil {
				t.Fatal(err)
			}
			if snapshot.Initialized != test.initialized || snapshot.LegacyUnpinned == nil || len(snapshot.LegacyUnpinned) != 0 {
				t.Fatalf("snapshot = %+v", snapshot)
			}
		})
	}
}

func TestPluginApprovalRejectsInvalidLegacyUnpinnedMarkers(t *testing.T) {
	validLock := `{"version":"1.0.0","hash":"sha256-a"}`
	tests := []string{
		`{"version":1,"initialized":true,"allowed":["mill-a"],"locks":{},"legacyUnpinned":null}`,
		`{"version":1,"initialized":true,"allowed":["mill-a"],"locks":{},"legacyUnpinned":["mill-a","mill-a"]}`,
		`{"version":1,"initialized":true,"allowed":[],"locks":{},"legacyUnpinned":["mill-a"]}`,
		`{"version":1,"initialized":false,"allowed":["mill-a"],"locks":{},"legacyUnpinned":["mill-a"]}`,
		`{"version":1,"initialized":true,"allowed":["mill-a"],"locks":{"mill-a":` + validLock + `},"legacyUnpinned":["mill-a"]}`,
		`{"version":1,"initialized":true,"allowed":["mill-a"],"locks":{}}`,
	}
	for _, payload := range tests {
		if state, err := decodePluginApprovalState([]byte(payload)); err == nil {
			t.Fatalf("decodePluginApprovalState(%s) = %+v", payload, state)
		}
	}
}

func TestLegacyUnpinnedTransitionRequiresExplicitDecision(t *testing.T) {
	store := servicetest.NewFakeStore()
	if err := store.Set(allowedPluginsKey, `["mill-a"]`); err != nil {
		t.Fatal(err)
	}
	service := settingsServiceForApprovalTest(store)
	wireApprovalMemory(service)
	WirePluginRemoval(service, func(_ string, action func(string, bool, bool) error) error {
		return action("/installed/mill-a", false, true)
	})
	service.SetPluginHasher(func(string) (PluginGrantSnapshot, error) {
		return PluginGrantSnapshot{Version: "1.0.0", Hash: "sha256-current", NetworkGrantVersion: 1, NetworkMethods: map[string][]string{}}, nil
	})
	if !service.PluginLockMatches("mill-a", "sha256-current") {
		t.Fatal("validated legacy unpinned approval did not preserve the historical exception")
	}
	if err := service.SetPluginAllowed("mill-a", true); err != nil {
		t.Fatal(err)
	}
	snapshot, err := ReadPluginApprovalSnapshot(service)
	if err != nil {
		t.Fatal(err)
	}
	if len(snapshot.LegacyUnpinned) != 0 || snapshot.Locks["mill-a"].Hash != "sha256-current" {
		t.Fatalf("explicit reallow snapshot = %+v", snapshot)
	}
	if err := service.SetPluginAllowed("mill-a", false); err != nil {
		t.Fatal(err)
	}
	snapshot, err = ReadPluginApprovalSnapshot(service)
	if err != nil {
		t.Fatal(err)
	}
	if containsPluginID(snapshot.Allowed, "mill-a") || containsPluginID(snapshot.LegacyUnpinned, "mill-a") {
		t.Fatalf("revoked snapshot = %+v", snapshot)
	}
}

func TestLegacyUnpinnedPersistsAcrossRestartAndNeverRemigratesOldSettings(t *testing.T) {
	store := servicetest.NewFakeStore()
	if err := store.Set(allowedPluginsKey, `["mill-a"]`); err != nil {
		t.Fatal(err)
	}
	memory := &persistedApprovalMemory{}
	first := settingsServiceForApprovalTest(store)
	memory.wire(first)
	initial, err := ReadPluginApprovalSnapshot(first)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(initial.LegacyUnpinned, []string{"mill-a"}) {
		t.Fatalf("initial marker = %v", initial.LegacyUnpinned)
	}

	if err := store.Set(allowedPluginsKey, `["mill-b"]`); err != nil {
		t.Fatal(err)
	}
	second := settingsServiceForApprovalTest(store)
	memory.wire(second)
	restarted, err := ReadPluginApprovalSnapshot(second)
	if err != nil {
		t.Fatal(err)
	}
	if restarted.Revision != initial.Revision || !reflect.DeepEqual(restarted.Allowed, []string{"mill-a"}) || !reflect.DeepEqual(restarted.LegacyUnpinned, []string{"mill-a"}) {
		t.Fatalf("restarted snapshot remigrated legacy settings: %+v", restarted)
	}
}

func TestFailedLegacyApprovalMigrationPublishesNoAuthority(t *testing.T) {
	store := servicetest.NewFakeStore()
	if err := store.Set(allowedPluginsKey, `["mill-a"]`); err != nil {
		t.Fatal(err)
	}
	memory := &persistedApprovalMemory{updateErr: errors.New("injected approval publication failure")}
	service := settingsServiceForApprovalTest(store)
	memory.wire(service)
	if _, err := ReadPluginApprovalSnapshot(service); err == nil {
		t.Fatal("migration unexpectedly succeeded")
	}
	if memory.payload != nil || memory.revision != 0 {
		t.Fatalf("failed migration published payload %q at revision %d", memory.payload, memory.revision)
	}
	if got := store.Get(allowedPluginsKey); got != `["mill-a"]` {
		t.Fatalf("failed migration changed legacy bytes to %#v", got)
	}
}

func TestLegacyUnpinnedForgetAndRemovalNeverRecreateMarker(t *testing.T) {
	for _, transition := range []string{"forget", "remove"} {
		t.Run(transition, func(t *testing.T) {
			store := servicetest.NewFakeStore()
			if err := store.Set(allowedPluginsKey, `["mill-a"]`); err != nil {
				t.Fatal(err)
			}
			memory := &persistedApprovalMemory{}
			service := settingsServiceForApprovalTest(store)
			memory.wire(service)
			if _, err := ReadPluginApprovalSnapshot(service); err != nil {
				t.Fatal(err)
			}
			if transition == "forget" {
				if err := service.forgetPluginLock("mill-a"); err != nil {
					t.Fatal(err)
				}
			} else {
				dir := installedFolder(t, "mill-a")
				WirePluginRemoval(service, func(_ string, action func(string, bool, bool) error) error {
					return action(dir, false, true)
				})
				destination, err := service.RemovePlugin("mill-a")
				if err != nil {
					t.Fatal(err)
				}
				t.Cleanup(func() { _ = os.RemoveAll(destination) })
			}
			snapshot, err := ReadPluginApprovalSnapshot(service)
			if err != nil {
				t.Fatal(err)
			}
			if len(snapshot.LegacyUnpinned) != 0 || service.PluginLockMatches("mill-a", "sha256-current") {
				t.Fatalf("%s left or recreated historical authority: %+v", transition, snapshot)
			}
			if transition == "remove" && containsPluginID(snapshot.Allowed, "mill-a") {
				t.Fatalf("removal retained allowed membership: %+v", snapshot)
			}
		})
	}
}

func settingsServiceForApprovalTest(store *servicetest.FakeStore) *SettingsService {
	composition := compositionsvc.NewCompositionService(store)
	triggers := triggersvc.NewTriggerService(composition, slog.Default(), store)
	return NewSettingsService(store, triggers, false)
}
