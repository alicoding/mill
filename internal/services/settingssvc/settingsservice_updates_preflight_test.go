package settingssvc

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/alicoding/mill/internal/adapters/pluginstate"
	"github.com/alicoding/mill/internal/domain/usererror"
	"github.com/alicoding/mill/internal/services/pluginsvc"
	"github.com/wailsapp/wails/v3/pkg/updater"
)

func updaterForPreflightTest(t *testing.T, provider updater.Provider) *updater.Updater {
	t.Helper()
	u := updater.New(&fakeUpdaterHost{})
	if err := u.Init(updater.Config{
		CurrentVersion: "0.4.0-beta.800",
		Providers:      []updater.Provider{provider},
	}); err != nil {
		t.Fatalf("Init: %v", err)
	}
	return u
}

func assertUpdateUserError(t *testing.T, err error, code, message, causeFragment string) {
	t.Helper()
	got, ok := usererror.Of(err)
	if !ok || got.Code != code || got.Message != message {
		t.Fatalf("usererror = %+v, %v, want %s / %q", got, ok, code, message)
	}
	if cause := errors.Unwrap(got); cause == nil || !strings.Contains(cause.Error(), causeFragment) {
		t.Fatalf("wrapped cause = %v, want it to contain %q", cause, causeFragment)
	}
}

func TestDownloadAndInstallUpdate_SchemaOneSnapshotPrecedesAdoptedDownload(t *testing.T) {
	pluginDir := t.TempDir()
	store := pluginstate.New(pluginDir)
	payload := []byte(`{"version":2,"sources":[],"indexes":{},"updates":{}}`)
	if _, _, err := store.Update(context.Background(),
		func() ([]byte, error) { return payload, nil },
		func(current []byte) ([]byte, error) { return current, nil }); err != nil {
		t.Fatalf("create schema-1 plugin state: %v", err)
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}

	body := []byte("mill-artifact")
	provider := &fakeUpdaterProvider{rel: releaseFor("0.4.0-beta.900", body), body: body}
	s := newTestSettingsService(t)
	s.SetUpdater(updaterForPreflightTest(t, provider))
	s.SetUpdateChannel("beta")
	snapshotDir := t.TempDir()
	var snapshotRan bool
	s.SetBackupRunner(func(int) (string, error) {
		if len(provider.downloadLog) != 0 {
			t.Fatal("the adopted updater downloaded before the participant snapshot")
		}
		snapshotRan = true
		participantDir := filepath.Join(snapshotDir, "plugin-state")
		if err := pluginsvc.SnapshotStoredState(pluginDir, participantDir); err != nil {
			return "", err
		}
		if err := pluginsvc.ValidateStoredSnapshot(filepath.Join(participantDir, "catalog.sqlite"), nil); err != nil {
			return "", err
		}
		return snapshotDir, nil
	})
	swapResignBundleFn(t, func(string) error { return nil })

	if _, err := s.CheckForUpdates(); err != nil {
		t.Fatal(err)
	}
	if err := s.DownloadAndInstallUpdate(); err != nil {
		t.Fatal(err)
	}
	if !snapshotRan || len(provider.downloadLog) != 1 {
		t.Fatalf("snapshotRan = %v, download log = %v", snapshotRan, provider.downloadLog)
	}
	if n := s.UpdateNoticeState(); n.State != UpdateStateReady || n.StateVersion != "0.4.0-beta.900" {
		t.Fatalf("notice = %+v, want ready 0.4.0-beta.900", n)
	}
}

func TestDownloadAndInstallUpdate_BackupFailureIsActionableAndPreservesStaging(t *testing.T) {
	t.Run("fresh failure projects the backup stage and diagnosis", func(t *testing.T) {
		body := []byte("mill-artifact")
		provider := &fakeUpdaterProvider{rel: releaseFor("0.4.0-beta.900", body), body: body}
		s := newTestSettingsService(t)
		s.SetUpdater(updaterForPreflightTest(t, provider))
		s.SetUpdateChannel("beta")
		s.SetBackupRunner(func(int) (string, error) {
			return "", errors.New(`backup: participant "plugin-state": extension source database schema 2 is not supported`)
		})

		if _, err := s.CheckForUpdates(); err != nil {
			t.Fatal(err)
		}
		err := s.DownloadAndInstallUpdate()
		assertUpdateUserError(t, err, updateBackupFailedCode, updateBackupFailedMessage, "schema 2 is not supported")
		if len(provider.downloadLog) != 0 {
			t.Fatalf("download log = %v, want no Wails download", provider.downloadLog)
		}
		n := s.UpdateNoticeState()
		if n.State != UpdateStateError || n.StateReasonStage != string(UpdateFailureStageBackup) {
			t.Fatalf("notice = %+v, want error stage backup", n)
		}
		if !strings.Contains(n.StateReason, "schema 2 is not supported") {
			t.Fatalf("StateReason = %q, want the copyable participant cause", n.StateReason)
		}
	})

	t.Run("a preflight failure leaves prior Wails staging intact", func(t *testing.T) {
		body := []byte("mill-artifact-v1")
		provider := &fakeUpdaterProvider{rel: releaseFor("0.4.0-beta.900", body), body: body}
		u := updaterForPreflightTest(t, provider)
		s := newTestSettingsService(t)
		s.SetUpdater(u)
		s.SetUpdateChannel("beta")
		s.SetBackupRunner(func(int) (string, error) { return "/backups/ok", nil })
		swapResignBundleFn(t, func(string) error { return nil })
		if _, err := s.CheckForUpdates(); err != nil {
			t.Fatal(err)
		}
		if err := s.DownloadAndInstallUpdate(); err != nil {
			t.Fatal(err)
		}
		priorPath := u.DownloadedPath()
		priorVersion := s.stagedUpdateVersion

		body = []byte("mill-artifact-v2")
		provider.rel = releaseFor("0.4.0-beta.901", body)
		provider.body = body
		if _, err := s.CheckForUpdates(); err != nil {
			t.Fatal(err)
		}
		s.SetBackupRunner(func(int) (string, error) { return "", errors.New("participant rejected") })
		err := s.DownloadAndInstallUpdate()
		assertUpdateUserError(t, err, updateBackupFailedCode, updateBackupFailedMessage, "participant rejected")
		if len(provider.downloadLog) != 1 {
			t.Fatalf("download log = %v, want only the original successful download", provider.downloadLog)
		}
		if !s.updateReady || s.stagedUpdateVersion != priorVersion || u.DownloadedPath() != priorPath {
			t.Fatalf("ready = %v, staged version = %q, path = %q; want retained %q at %q", s.updateReady, s.stagedUpdateVersion, u.DownloadedPath(), priorVersion, priorPath)
		}
		if _, err := os.Stat(priorPath); err != nil {
			t.Fatalf("prior staged artifact was removed: %v", err)
		}
		if s.lastInstallStage != UpdateFailureStageBackup {
			t.Fatalf("lastInstallStage = %q, want backup", s.lastInstallStage)
		}
	})
}

func TestDownloadAndInstallUpdate_ProviderFailureReturnsDownloadCode(t *testing.T) {
	body := []byte("mill-artifact")
	provider := &fakeUpdaterProvider{
		rel: releaseFor("0.4.0-beta.900", body),
		dlErrForVersion: map[string]error{
			"0.4.0-beta.900": errors.New("github: download: HTTP 403"),
		},
	}
	s := newTestSettingsService(t)
	s.SetUpdater(updaterForPreflightTest(t, provider))
	s.SetUpdateChannel("beta")
	s.SetBackupRunner(func(int) (string, error) { return "/backups/ok", nil })
	if _, err := s.CheckForUpdates(); err != nil {
		t.Fatal(err)
	}
	err := s.DownloadAndInstallUpdate()
	assertUpdateUserError(t, err, updateDownloadFailedCode, updateDownloadFailedMessage, "HTTP 403")
	if n := s.UpdateNoticeState(); n.State != UpdateStateError || n.StateReasonStage != string(UpdateFailureStageDownload) {
		t.Fatalf("notice = %+v, want error stage download", n)
	}
}

func TestDownloadAndInstallUpdate_VerificationFailureReturnsInstallCode(t *testing.T) {
	tests := []struct {
		name  string
		cause string
		alter func(*updater.Release)
	}{
		{"unknown digest algorithm", "unknown digest algorithm", func(rel *updater.Release) {
			rel.Verification.DigestAlgo = "sha999"
		}},
		{"incomplete signature metadata", "signatureAlgo missing", func(rel *updater.Release) {
			rel.Verification.Signature = []byte("signature")
		}},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			body := []byte("mill-artifact")
			rel := releaseFor("0.4.0-beta.900", body)
			tc.alter(rel)
			provider := &fakeUpdaterProvider{rel: rel, body: body}
			s := newTestSettingsService(t)
			s.SetUpdater(updaterForPreflightTest(t, provider))
			s.SetUpdateChannel("beta")
			s.SetBackupRunner(func(int) (string, error) { return "/backups/ok", nil })
			if _, err := s.CheckForUpdates(); err != nil {
				t.Fatal(err)
			}
			err := s.DownloadAndInstallUpdate()
			assertUpdateUserError(t, err, updateInstallFailedCode, updateInstallFailedMessage, tc.cause)
			if n := s.UpdateNoticeState(); n.State != UpdateStateError || n.StateReasonStage != string(UpdateFailureStageInstall) {
				t.Fatalf("notice = %+v, want error stage install", n)
			}
		})
	}
}
