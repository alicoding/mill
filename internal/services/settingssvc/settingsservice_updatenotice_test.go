package settingssvc

// UpdateNotice/UpdateNoticeState coverage -- split from
// settingsservice_updates_test.go at the 500-line convention
// (architecture.md), mirroring the settingsservice_updatenotice.go /
// settingsservice_updates.go production split.

import (
	"testing"
	"time"
)

func TestUpdateNotice_AvailableDismissalIsPerVersion(t *testing.T) {
	set := newTestSettingsService(t)
	set.recordAvailableUpdate("0.4.0-beta.700")
	if n := set.UpdateNoticeState(); n.AvailableVersion != "0.4.0-beta.700" {
		t.Fatalf("available = %q", n.AvailableVersion)
	}
	if err := set.DismissUpdateNotice(); err != nil {
		t.Fatal(err)
	}
	if n := set.UpdateNoticeState(); n.AvailableVersion != "" {
		t.Errorf("dismissed version still showing: %q", n.AvailableVersion)
	}
	set.recordAvailableUpdate("0.4.0-beta.700")
	if n := set.UpdateNoticeState(); n.AvailableVersion != "" {
		t.Errorf("dismissal must hold for the same version, got %q", n.AvailableVersion)
	}
	set.recordAvailableUpdate("0.4.0-beta.701")
	if n := set.UpdateNoticeState(); n.AvailableVersion != "0.4.0-beta.701" {
		t.Errorf("a NEWER version must notify again, got %q", n.AvailableVersion)
	}
}

func TestUpdateNotice_ReadyWinsAndAutoCheckPrefPersists(t *testing.T) {
	set := newTestSettingsService(t)
	set.recordAvailableUpdate("0.4.0-beta.700")
	set.markUpdateReady()
	n := set.UpdateNoticeState()
	if !n.Ready || n.AvailableVersion != "" {
		t.Errorf("ready state = %+v, want ready with no available", n)
	}
	if set.AutoUpdateCheck() {
		t.Error("auto-check must default OFF")
	}
	if err := set.SetAutoUpdateCheck(true); err != nil {
		t.Fatal(err)
	}
	if !set.AutoUpdateCheck() {
		t.Error("auto-check did not persist")
	}
}

// The update-available fire is once per version, surviving restarts
// via the store, and never fires for a dismissed version (goal 0146).
func TestRecordAvailableUpdate_FiresSinkOncePerVersion(t *testing.T) {
	s := newTestSettingsService(t)
	var fired []string
	s.SetUpdateEventSink(func(version, channel string) { fired = append(fired, version) })

	s.recordAvailableUpdate("v1.2.3")
	s.recordAvailableUpdate("v1.2.3")
	if len(fired) != 1 || fired[0] != "v1.2.3" {
		t.Fatalf("fired = %v, want exactly one v1.2.3", fired)
	}
	s.recordAvailableUpdate("v1.2.4")
	if len(fired) != 2 || fired[1] != "v1.2.4" {
		t.Fatalf("fired = %v, want the next version to fire once", fired)
	}
}

// Regression: a failing background check used to leave UpdateNoticeState
// looking exactly like "no update available" -- no fact anywhere recorded
// that a check even ran, let alone that it errored. CheckForUpdates must
// record the failed outcome on every error path, not just the success ones.
func TestCheckForUpdates_RecordsFailedOutcomeWithoutConfiguredUpdater(t *testing.T) {
	set := newTestSettingsService(t)
	before := set.UpdateNoticeState()
	if before.LastCheckOutcome != "" || before.LastCheckAt != "" {
		t.Fatalf("before any check: outcome=%q at=%q, want both empty", before.LastCheckOutcome, before.LastCheckAt)
	}

	if _, err := set.CheckForUpdates(); err == nil {
		t.Fatal("CheckForUpdates() with no updater configured: want an error, got nil")
	}

	n := set.UpdateNoticeState()
	if n.LastCheckOutcome != string(UpdateCheckOutcomeFailed) {
		t.Errorf("LastCheckOutcome = %q, want %q", n.LastCheckOutcome, UpdateCheckOutcomeFailed)
	}
	if n.LastCheckError == "" {
		t.Error("LastCheckError = \"\", want the failure reason")
	}
	if n.LastCheckAt == "" {
		t.Error("LastCheckAt = \"\", want a recorded timestamp")
	}
	if _, err := time.Parse(time.RFC3339, n.LastCheckAt); err != nil {
		t.Errorf("LastCheckAt = %q: not RFC3339: %v", n.LastCheckAt, err)
	}
}

// A subsequent successful check must clear the previous failure's error
// text -- LastCheckError only ever means something alongside the failed
// outcome.
func TestCheckForUpdates_SuccessClearsAPriorFailedCheckError(t *testing.T) {
	set := newTestSettingsService(t)
	if _, err := set.CheckForUpdates(); err == nil {
		t.Fatal("want an error with no updater configured")
	}
	if set.UpdateNoticeState().LastCheckError == "" {
		t.Fatal("setup: want a recorded failure error before the fake check")
	}

	t.Setenv(testUpdateFakeVersionEnv, "9.9.9")
	set.SetAppVersion("1.0.0")
	if _, err := set.CheckForUpdates(); err != nil {
		t.Fatalf("fake-mode CheckForUpdates() = %v, want nil", err)
	}

	n := set.UpdateNoticeState()
	if n.LastCheckOutcome != string(UpdateCheckOutcomeFound) {
		t.Errorf("LastCheckOutcome = %q, want %q", n.LastCheckOutcome, UpdateCheckOutcomeFound)
	}
	if n.LastCheckError != "" {
		t.Errorf("LastCheckError = %q, want cleared after a successful check", n.LastCheckError)
	}
}
