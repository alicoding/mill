package pluginsvc

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"github.com/alicoding/mill/internal/adapters/pluginstate"
)

type faultPluginState struct {
	pluginStateStore
	uncertainBeforeAt     map[int64]bool
	uncertainAt           map[int64]bool
	failAt                map[int64]bool
	listErrAfterUncertain error
	listErr               error
	deleteErr             error
}

func (s *faultPluginState) CompareAndSwapInstallTransaction(ctx context.Context, initializer pluginstate.Initializer, id string, revision int64, payload []byte) (int64, error) {
	if s.uncertainBeforeAt[revision] {
		delete(s.uncertainBeforeAt, revision)
		return 0, uncertainTestPublication{}
	}
	if s.failAt[revision] {
		delete(s.failAt, revision)
		return 0, errors.New("injected proven publication failure")
	}
	next, err := s.pluginStateStore.CompareAndSwapInstallTransaction(ctx, initializer, id, revision, payload)
	if err == nil && s.uncertainAt[revision] {
		delete(s.uncertainAt, revision)
		s.listErr = s.listErrAfterUncertain
		return 0, uncertainTestPublication{}
	}
	return next, err
}

func (s *faultPluginState) ListInstallTransactions(ctx context.Context) ([]pluginstate.InstallTransactionRecord, error) {
	if s.listErr != nil {
		err := s.listErr
		s.listErr = nil
		return nil, err
	}
	return s.pluginStateStore.ListInstallTransactions(ctx)
}

func (s *faultPluginState) DeleteInstallTransaction(ctx context.Context, id string, revision int64) error {
	if s.deleteErr != nil {
		return s.deleteErr
	}
	return s.pluginStateStore.DeleteInstallTransaction(ctx, id, revision)
}

type uncertainTestPublication struct{}

func (uncertainTestPublication) Error() string              { return "injected uncertain publication" }
func (uncertainTestPublication) PublicationUncertain() bool { return true }

func TestInitialPublicationUncertaintyCreatesNoWorkspaceBeforeAuthoritativeSuccess(t *testing.T) {
	for _, test := range []struct {
		name      string
		committed bool
	}{
		{name: "not committed"},
		{name: "committed", committed: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			service := New(t.TempDir(), nil, "")
			faults := &faultPluginState{pluginStateStore: service.state}
			if test.committed {
				faults.uncertainAt = map[int64]bool{0: true}
			} else {
				faults.uncertainBeforeAt = map[int64]bool{0: true}
			}
			service.state = faults
			source := writeDirectPlugin(t, "uncertain-install", "candidate")
			reservation, err := service.ReserveInstallPreparation()
			if err != nil {
				t.Fatal(err)
			}
			if _, err := service.PrepareInstall(reservation.Handle, InstallCandidate{Kind: "link", Locator: source}); err != nil {
				t.Fatal(err)
			}
			if result, err := service.ConfirmInstall(reservation.Handle); userErrorCode(err) != "install-recovery-required" || result.PluginID != "" {
				t.Fatalf("ConfirmInstall = %+v, %v", result, err)
			}
			root, err := service.canonicalPluginRoot()
			if err != nil {
				t.Fatal(err)
			}
			assertNoTransactionWorkspaceEntries(t, root)
			service = restartPluginService(t, service)
			if err := service.RecoverInstallations(); err != nil {
				t.Fatal(err)
			}
			if _, err := os.Stat(filepath.Join(root, "uncertain-install")); !os.IsNotExist(err) {
				t.Fatalf("recovery published an uncertain first install: %v", err)
			}
			assertNoInstallTransactions(t, service)
		})
	}
}

func TestPublicationUncertaintyRecoversFromEveryReplacementPhase(t *testing.T) {
	for _, test := range []struct {
		name             string
		expectedRevision int64
		wantBytes        string
	}{
		{name: "old retained", expectedRevision: 2, wantBytes: "old bytes"},
		{name: "promoted", expectedRevision: 3, wantBytes: "old bytes"},
		{name: "committed", expectedRevision: 4, wantBytes: "new bytes"},
	} {
		t.Run(test.name, func(t *testing.T) {
			service, source := installedReplacementFixture(t)
			faults := &faultPluginState{pluginStateStore: service.state, uncertainAt: map[int64]bool{test.expectedRevision: true}}
			service.state = faults

			if _, err := prepareAndConfirmForTest(t, service, InstallCandidate{Kind: "link", Locator: source}); userErrorCode(err) != "install-recovery-required" {
				t.Fatalf("ConfirmInstall error = %v", err)
			}
			if _, err := os.Stat(onlyTransactionPath(t, service, "")); err != nil {
				t.Fatalf("uncertain publication did not retain its workspace: %v", err)
			}
			if err := service.RecoverInstallations(); err != nil {
				t.Fatal(err)
			}
			installed, err := os.ReadFile(filepath.Join(service.dir, "replace-me", "main.js"))
			if err != nil || string(installed) != test.wantBytes {
				t.Fatalf("installed bytes = %q, error %v; want %q", installed, err, test.wantBytes)
			}
			assertNoInstallTransactions(t, service)
		})
	}
}

func TestProvenPublicationFailuresRestoreThePriorPackage(t *testing.T) {
	for _, expectedRevision := range []int64{0, 1, 2, 3, 4} {
		t.Run(fmt.Sprintf("expected revision %d", expectedRevision), func(t *testing.T) {
			service, source := installedReplacementFixture(t)
			faults := &faultPluginState{pluginStateStore: service.state, failAt: map[int64]bool{expectedRevision: true}}
			service.state = faults

			if _, err := prepareAndConfirmForTest(t, service, InstallCandidate{Kind: "link", Locator: source}); err == nil || userErrorCode(err) == "install-recovery-required" {
				t.Fatalf("ConfirmInstall error = %v, want recovered install failure", err)
			}
			installed, err := os.ReadFile(filepath.Join(service.dir, "replace-me", "main.js"))
			if err != nil || string(installed) != "old bytes" {
				t.Fatalf("installed bytes = %q, error %v", installed, err)
			}
			assertNoInstallTransactions(t, service)
		})
	}
}

func TestFilesystemMoveFailuresRestoreOrRetainRecoverableEvidence(t *testing.T) {
	tests := []struct {
		name         string
		rename       func(string, string) error
		wantRecovery bool
	}{
		{
			name: "retain old package",
			rename: func(source, destination string) error {
				if filepath.Base(source) == "replace-me" && filepath.Base(destination) == "backup" {
					return errors.New("injected old-package move failure")
				}
				return os.Rename(source, destination)
			},
		},
		{
			name: "promote candidate",
			rename: func(source, destination string) error {
				if filepath.Base(source) == "candidate" && filepath.Base(destination) == "replace-me" {
					return errors.New("injected candidate promotion failure")
				}
				return os.Rename(source, destination)
			},
		},
		{
			name:         "rollback restore",
			wantRecovery: true,
			rename: func(source, destination string) error {
				if filepath.Base(destination) == "replace-me" && (filepath.Base(source) == "candidate" || filepath.Base(source) == "backup") {
					return errors.New("injected promotion and rollback failure")
				}
				return os.Rename(source, destination)
			},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			service, source := installedReplacementFixture(t)
			service.installRename = test.rename

			_, err := prepareAndConfirmForTest(t, service, InstallCandidate{Kind: "link", Locator: source})
			if err == nil {
				t.Fatal("ConfirmInstall unexpectedly succeeded")
			}
			if got := userErrorCode(err) == "install-recovery-required"; got != test.wantRecovery {
				t.Fatalf("recovery-required error = %v, want %v (%v)", got, test.wantRecovery, err)
			}
			service.installRename = os.Rename
			if err := service.RecoverInstallations(); err != nil {
				t.Fatal(err)
			}
			installed, err := os.ReadFile(filepath.Join(service.dir, "replace-me", "main.js"))
			if err != nil || string(installed) != "old bytes" {
				t.Fatalf("installed bytes = %q, error %v", installed, err)
			}
			assertNoInstallTransactions(t, service)
		})
	}
}

func TestCommittedInstallCleanupFailuresReturnInstalledRecoveryResult(t *testing.T) {
	for _, test := range []struct {
		name   string
		inject func(*PluginService, *faultPluginState)
	}{
		{
			name: "backup removal",
			inject: func(service *PluginService, _ *faultPluginState) {
				service.installRemoveAll = func(path string) error {
					if filepath.Base(path) == "backup" {
						return errors.New("injected backup cleanup failure")
					}
					return os.RemoveAll(path)
				}
			},
		},
		{
			name: "workspace removal",
			inject: func(service *PluginService, _ *faultPluginState) {
				service.installRemove = func(path string) error {
					if installTransactionIDPattern.MatchString(filepath.Base(path)) {
						return errors.New("injected workspace cleanup failure")
					}
					return os.Remove(path)
				}
			},
		},
		{
			name: "record deletion",
			inject: func(_ *PluginService, faults *faultPluginState) {
				faults.deleteErr = errors.New("injected journal cleanup failure")
			},
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			service, source := installedReplacementFixture(t)
			faults := &faultPluginState{pluginStateStore: service.state}
			service.state = faults
			test.inject(service, faults)
			result := confirmReplacement(t, service, source)
			if result.PluginID != "replace-me" || result.Record.Version != "2.0.0" || !result.RecoveryRequired {
				t.Fatalf("result = %+v", result)
			}
			called := false
			if err := WithPluginMutation(service, "replace-me", func(string, bool, bool) error { called = true; return nil }); userErrorCode(err) != "install-recovery-required" {
				t.Fatalf("mutation during recovery error = %v", err)
			}
			if called {
				t.Fatal("mutation ran while cleanup recovery was unresolved")
			}
			service.installRemoveAll = os.RemoveAll
			service.installRemove = os.Remove
			faults.deleteErr = nil
			if err := service.RecoverInstallations(); err != nil {
				t.Fatal(err)
			}
			installed, err := os.ReadFile(filepath.Join(service.dir, "replace-me", "main.js"))
			if err != nil || string(installed) != "new bytes" {
				t.Fatalf("installed bytes = %q, error %v", installed, err)
			}
			assertNoInstallTransactions(t, service)
		})
	}
}

func TestChangedRetainedEvidenceRefusesDestructiveRecovery(t *testing.T) {
	for _, relative := range []string{".hidden", filepath.Join("node_modules", "dependency.js"), InstallRecordFile} {
		t.Run(relative, func(t *testing.T) {
			service, source := installedReplacementFixture(t)
			if err := os.MkdirAll(filepath.Dir(filepath.Join(service.dir, "replace-me", relative)), 0o750); err != nil {
				t.Fatal(err)
			}
			if relative != InstallRecordFile {
				if err := os.WriteFile(filepath.Join(service.dir, "replace-me", relative), []byte("retained evidence"), 0o600); err != nil {
					t.Fatal(err)
				}
			}
			service.installRemoveAll = func(path string) error {
				if filepath.Base(path) == "backup" {
					return errors.New("retain backup")
				}
				return os.RemoveAll(path)
			}
			result := confirmReplacement(t, service, source)
			if !result.RecoveryRequired {
				t.Fatalf("result = %+v", result)
			}
			service.installRemoveAll = os.RemoveAll
			backup := onlyTransactionPath(t, service, "backup")
			if err := os.WriteFile(filepath.Join(backup, relative), []byte("changed evidence"), 0o600); err != nil {
				t.Fatal(err)
			}
			if err := service.RecoverInstallations(); userErrorCode(err) != "install-recovery-required" {
				t.Fatalf("RecoverInstallations error = %v", err)
			}
			if _, err := os.Stat(backup); err != nil {
				t.Fatalf("recovery deleted changed evidence: %v", err)
			}
		})
	}
}

func installedReplacementFixture(t *testing.T) (*PluginService, string) {
	t.Helper()
	service := New(t.TempDir(), nil, "")
	source := writeDirectPlugin(t, "replace-me", "old bytes")
	if _, err := prepareAndConfirmForTest(t, service, InstallCandidate{Kind: "link", Locator: source}); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(source, "manifest.json"), []byte(`{"id":"replace-me","name":"Direct","version":"2.0.0"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(source, "main.js"), []byte("new bytes"), 0o600); err != nil {
		t.Fatal(err)
	}
	return service, source
}

func confirmReplacement(t *testing.T, service *PluginService, source string) InstallCommitResult {
	t.Helper()
	result, err := prepareAndConfirmForTest(t, service, InstallCandidate{Kind: "link", Locator: source})
	if err != nil {
		t.Fatal(err)
	}
	return result
}

func assertNoInstallTransactions(t *testing.T, service *PluginService) {
	t.Helper()
	records, err := service.state.ListInstallTransactions(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(records) != 0 {
		t.Fatalf("install transactions = %+v", records)
	}
}

func onlyTransactionPath(t *testing.T, service *PluginService, leaf string) string {
	t.Helper()
	root, err := service.canonicalPluginRoot()
	if err != nil {
		t.Fatal(err)
	}
	entries, err := os.ReadDir(transactionWorkspaceRoot(root))
	if err != nil || len(entries) != 1 {
		t.Fatalf("transaction workspaces = %v, error %v", entries, err)
	}
	return filepath.Join(transactionWorkspaceRoot(root), entries[0].Name(), leaf)
}
