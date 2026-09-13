package settingssvc

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/alicoding/mill/internal/adapters/pluginstate"
	"github.com/alicoding/mill/internal/domain/usererror"
	"github.com/alicoding/mill/internal/services/dataevent"
	"github.com/alicoding/mill/internal/services/servicetest"
)

// installedFolder makes a plugin-shaped folder on disk to remove.
func installedFolder(t *testing.T, name string) string {
	t.Helper()
	dir := filepath.Join(t.TempDir(), name)
	if err := os.MkdirAll(dir, 0o750); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "manifest.json"), []byte(`{"id":"`+name+`"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	return dir
}

// TestRemovePlugin_UnwiredReportsUnavailable pins the fail-closed
// default: a build with no plugin service never removes anything.
func TestRemovePlugin_UnwiredReportsUnavailable(t *testing.T) {
	set := newExtensionsHarness(t)
	set.pluginMutation = nil
	if _, err := set.RemovePlugin("mill-a"); !errors.Is(err, errRemovalUnavailable) {
		t.Fatalf("err = %v, want errRemovalUnavailable", err)
	}
}

// TestRemovePlugin_TrashesTheFolderAndWithdrawsConsent is the whole
// contract: the folder leaves its install path, the reported
// destination exists, and the plugin is no longer allowed to run --
// so copying it back in later asks for consent again.
func TestRemovePlugin_TrashesTheFolderAndWithdrawsConsent(t *testing.T) {
	set := newExtensionsHarness(t)
	dir := installedFolder(t, "mill-a")
	WirePluginRemoval(set, func(id string, action func(string, bool, bool) error) error {
		if id != "mill-a" {
			return action("", false, false)
		}
		return action(dir, false, true)
	})
	if err := set.SetPluginAllowed("mill-a", true); err != nil {
		t.Fatal(err)
	}

	dest, err := set.RemovePlugin("mill-a")
	if err != nil {
		t.Fatalf("RemovePlugin: %v", err)
	}
	if _, err := os.Stat(dir); !os.IsNotExist(err) {
		t.Errorf("the folder is still installed (stat err = %v)", err)
	}
	if _, err := os.Stat(dest); err != nil {
		t.Errorf("reported destination %q is not there: %v", dest, err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(dest) })
	if got, err := set.GetAllowedPlugins(); err != nil || len(got) != 0 {
		t.Errorf("allowed = %v, want empty -- removal withdraws consent", got)
	}
}

// TestRemovePlugin_RefusesUnknownAndBuiltIn pins the two refusals: an
// id nothing installed answers to, and one of Mill's own bundled
// plugins, which lives inside the app bundle.
func TestRemovePlugin_RefusesUnknownAndBuiltIn(t *testing.T) {
	set := newExtensionsHarness(t)
	dir := installedFolder(t, "mill-drawing")
	WirePluginRemoval(set, func(id string, action func(string, bool, bool) error) error {
		if id != "mill-drawing" {
			return action("", false, false)
		}
		return action(dir, true, true)
	})

	if _, err := set.RemovePlugin("nobody"); !errors.Is(err, errPluginNotInstalled) {
		t.Errorf("unknown id err = %v, want errPluginNotInstalled", err)
	}
	if _, err := set.RemovePlugin("mill-drawing"); !errors.Is(err, errPluginBuiltIn) {
		t.Errorf("built-in err = %v, want errPluginBuiltIn", err)
	}
	if _, err := os.Stat(dir); err != nil {
		t.Errorf("a refused removal must leave the folder alone: %v", err)
	}
}

func TestRemovePlugin_ApprovalFailureLeavesOriginalBytesAndPublishesNothing(t *testing.T) {
	tests := []struct {
		name     string
		memory   *persistedApprovalMemory
		wantCode string
	}{
		{name: "corrupt", memory: &persistedApprovalMemory{payload: []byte("{"), revision: 3}, wantCode: "plugin-approval-corrupt"},
		{name: "publication failure", memory: &persistedApprovalMemory{updateErr: errors.New("injected approval failure")}, wantCode: "plugin-approval-save-failed"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			set := newExtensionsHarness(t)
			test.memory.wire(set)
			dir := installedFolder(t, "mill-a")
			WirePluginRemoval(set, func(_ string, action func(string, bool, bool) error) error {
				return action(dir, false, true)
			})
			trashCalled := false
			set.pluginTrash = func(string) (string, error) {
				trashCalled = true
				return "", nil
			}
			policyChanged := 0
			set.SetPluginPolicyChanged(func() { policyChanged++ })
			var events int
			previousHook := dataevent.TestHook
			dataevent.TestHook = func(entity, id string) {
				if entity == "extension" && id == "mill-a" {
					events++
				}
			}
			t.Cleanup(func() { dataevent.TestHook = previousHook })

			if _, err := set.RemovePlugin("mill-a"); pluginRemovalErrorCode(err) != test.wantCode {
				t.Fatalf("RemovePlugin error = %v, want %s", err, test.wantCode)
			}
			if trashCalled {
				t.Fatal("Trash was called without authoritative approval withdrawal")
			}
			if _, err := os.Stat(dir); err != nil {
				t.Fatalf("refused removal changed original bytes: %v", err)
			}
			if policyChanged != 0 || events != 0 {
				t.Fatalf("refused approval emitted policy=%d events=%d", policyChanged, events)
			}
		})
	}
}

func TestRemovePlugin_TrashFailureKeepsApprovalWithdrawnAndRetryNeverRegrants(t *testing.T) {
	store := servicetest.NewFakeStore()
	memory := &persistedApprovalMemory{}
	set := settingsServiceForApprovalTest(store)
	memory.wire(set)
	dir := installedFolder(t, "mill-a")
	inMutation := false
	WirePluginRemoval(set, func(_ string, action func(string, bool, bool) error) error {
		inMutation = true
		defer func() { inMutation = false }()
		return action(dir, false, true)
	})
	set.SetPluginHasher(func(string) (PluginGrantSnapshot, error) {
		return PluginGrantSnapshot{Version: "1.0.0", Hash: "sha256-original", NetworkGrantVersion: 1, NetworkMethods: map[string][]string{}}, nil
	})
	if err := set.SetPluginAllowed("mill-a", true); err != nil {
		t.Fatal(err)
	}

	trashErr := errors.New("injected Trash failure")
	set.pluginTrash = func(string) (string, error) { return "", trashErr }
	policyCalls := 0
	notifiedWhileLocked := false
	set.SetPluginPolicyChanged(func() {
		policyCalls++
		notifiedWhileLocked = notifiedWhileLocked || inMutation
		if snapshot, err := ReadPluginApprovalSnapshot(set); err != nil || containsPluginID(snapshot.Allowed, "mill-a") {
			t.Errorf("policy callback approval = %+v, %v", snapshot, err)
		}
	})
	var events int
	previousHook := dataevent.TestHook
	dataevent.TestHook = func(entity, id string) {
		if entity == "extension" && id == "mill-a" {
			events++
		}
	}
	t.Cleanup(func() { dataevent.TestHook = previousHook })

	_, err := set.RemovePlugin("mill-a")
	if pluginRemovalErrorCode(err) != "plugin-remove-trash-failed" || !errors.Is(err, trashErr) {
		t.Fatalf("RemovePlugin error = %v", err)
	}
	if got := err.Error(); got != "Extension approval was removed, but Mill could not move its folder to the Trash. Try removing it again." {
		t.Fatalf("RemovePlugin message = %q", got)
	}
	if _, statErr := os.Stat(dir); statErr != nil {
		t.Fatalf("reported Trash failure did not preserve the folder: %v", statErr)
	}
	if policyCalls != 1 || events != 1 || notifiedWhileLocked {
		t.Fatalf("partial removal notifications policy=%d events=%d whileLocked=%v", policyCalls, events, notifiedWhileLocked)
	}
	snapshot, err := ReadPluginApprovalSnapshot(set)
	if err != nil || containsPluginID(snapshot.Allowed, "mill-a") || snapshot.Locks["mill-a"].Hash != "" {
		t.Fatalf("partial removal approval = %+v, %v", snapshot, err)
	}

	rewired := settingsServiceForApprovalTest(store)
	memory.wire(rewired)
	retryDestination := filepath.Join(t.TempDir(), "trashed-mill-a")
	WirePluginRemoval(rewired, func(_ string, action func(string, bool, bool) error) error {
		return action(dir, false, true)
	})
	rewired.pluginTrash = func(source string) (string, error) {
		if err := os.Rename(source, retryDestination); err != nil {
			return "", err
		}
		return retryDestination, nil
	}
	destination, err := rewired.RemovePlugin("mill-a")
	if err != nil || destination != retryDestination {
		t.Fatalf("retry RemovePlugin = %q, %v", destination, err)
	}
	rewiredSnapshot, err := ReadPluginApprovalSnapshot(rewired)
	if err != nil || containsPluginID(rewiredSnapshot.Allowed, "mill-a") || len(rewiredSnapshot.Locks) != 0 {
		t.Fatalf("retry regranted approval: %+v, %v", rewiredSnapshot, err)
	}
}

func TestRemovePlugin_TrashFailureKeepsWithdrawalAcrossSQLiteReopen(t *testing.T) {
	settingsStore := servicetest.NewFakeStore()
	stateDir := t.TempDir()
	state := pluginstate.New(stateDir)
	service := settingsServiceForApprovalTest(settingsStore)
	wireSQLiteApprovalStore(service, state)
	dir := installedFolder(t, "mill-a")
	WirePluginRemoval(service, func(_ string, action func(string, bool, bool) error) error {
		return action(dir, false, true)
	})
	service.SetPluginHasher(func(string) (PluginGrantSnapshot, error) {
		return PluginGrantSnapshot{Version: "1.0.0", Hash: "sha256-original", NetworkGrantVersion: 1, NetworkMethods: map[string][]string{}}, nil
	})
	if err := service.SetPluginAllowed("mill-a", true); err != nil {
		t.Fatal(err)
	}
	service.pluginTrash = func(string) (string, error) { return "", errors.New("injected Trash failure") }
	if _, err := service.RemovePlugin("mill-a"); pluginRemovalErrorCode(err) != "plugin-remove-trash-failed" {
		t.Fatalf("RemovePlugin error = %v", err)
	}
	if err := state.Close(); err != nil {
		t.Fatal(err)
	}

	reopenedState := pluginstate.New(stateDir)
	t.Cleanup(func() { _ = reopenedState.Close() })
	reopened := settingsServiceForApprovalTest(settingsStore)
	wireSQLiteApprovalStore(reopened, reopenedState)
	reopenedSnapshot, err := ReadPluginApprovalSnapshot(reopened)
	if err != nil || containsPluginID(reopenedSnapshot.Allowed, "mill-a") || len(reopenedSnapshot.Locks) != 0 {
		t.Fatalf("reopened approval = %+v, %v", reopenedSnapshot, err)
	}
	if _, err := os.Stat(dir); err != nil {
		t.Fatalf("failed Trash did not preserve installed bytes: %v", err)
	}

	retryDestination := filepath.Join(t.TempDir(), "trashed-mill-a")
	WirePluginRemoval(reopened, func(_ string, action func(string, bool, bool) error) error {
		return action(dir, false, true)
	})
	reopened.pluginTrash = func(source string) (string, error) {
		if err := os.Rename(source, retryDestination); err != nil {
			return "", err
		}
		return retryDestination, nil
	}
	if destination, err := reopened.RemovePlugin("mill-a"); err != nil || destination != retryDestination {
		t.Fatalf("retry RemovePlugin = %q, %v", destination, err)
	}
	finalSnapshot, err := ReadPluginApprovalSnapshot(reopened)
	if err != nil || containsPluginID(finalSnapshot.Allowed, "mill-a") || len(finalSnapshot.Locks) != 0 {
		t.Fatalf("retry regranted approval: %+v, %v", finalSnapshot, err)
	}
}

func TestRemovePlugin_UsesReconciledApprovalOutcomeBeforeTrash(t *testing.T) {
	for _, test := range []struct {
		name        string
		outcome     string
		wantTrash   bool
		wantErrCode string
	}{
		{name: "committed with error and intended readback", outcome: "intended", wantTrash: true},
		{name: "commit error and prior readback", outcome: "prior", wantErrCode: "plugin-approval-save-failed"},
		{name: "commit error and unknown readback", outcome: "unknown", wantErrCode: "plugin-approval-save-failed"},
	} {
		t.Run(test.name, func(t *testing.T) {
			state := pluginApprovalState{
				Version: pluginApprovalStateVersion, Initialized: true, Allowed: []string{"mill-a"},
				Locks: map[string]PluginLockEntry{"mill-a": {Version: "1.0.0", Hash: "sha256-original"}}, LegacyUnpinned: []string{},
			}
			payload, err := encodePluginApprovalState(state)
			if err != nil {
				t.Fatal(err)
			}
			service := settingsServiceForApprovalTest(servicetest.NewFakeStore())
			SetPluginApprovalStore(service,
				func() ([]byte, int64, bool, error) { return append([]byte(nil), payload...), 1, true, nil },
				func(_ PluginApprovalInitializer, change PluginApprovalChange) ([]byte, int64, error) {
					intended, err := change(append([]byte(nil), payload...))
					if err != nil {
						return nil, 0, err
					}
					switch test.outcome {
					case "intended":
						payload = append([]byte(nil), intended...)
						return append([]byte(nil), intended...), 2, nil
					case "prior":
						return nil, 0, errors.New("commit failed and authoritative state stayed prior")
					default:
						return nil, 0, errors.New("commit failed and authoritative state was unknown")
					}
				},
			)
			dir := installedFolder(t, "mill-a")
			WirePluginRemoval(service, func(_ string, action func(string, bool, bool) error) error {
				return action(dir, false, true)
			})
			trashCalled := false
			service.pluginTrash = func(string) (string, error) {
				trashCalled = true
				return "/Trash/mill-a", nil
			}
			_, err = service.RemovePlugin("mill-a")
			if got := pluginRemovalErrorCode(err); got != test.wantErrCode {
				t.Fatalf("RemovePlugin error code = %q (%v), want %q", got, err, test.wantErrCode)
			}
			if trashCalled != test.wantTrash {
				t.Fatalf("Trash called = %v, want %v", trashCalled, test.wantTrash)
			}
		})
	}
}

func wireSQLiteApprovalStore(service *SettingsService, state *pluginstate.Store) {
	SetPluginApprovalStore(service,
		func() ([]byte, int64, bool, error) {
			return state.LoadApproval(context.Background())
		},
		func(initializer PluginApprovalInitializer, change PluginApprovalChange) ([]byte, int64, error) {
			return state.UpdateApproval(context.Background(),
				func() ([]byte, error) { return []byte(`{}`), nil },
				func() ([]byte, error) { return initializer() },
				func(current []byte) ([]byte, error) { return change(current) },
			)
		},
	)
}

func pluginRemovalErrorCode(err error) string {
	if err == nil {
		return ""
	}
	if value, ok := usererror.Of(err); ok {
		return value.Code
	}
	return ""
}
