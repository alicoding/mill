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
	t.Cleanup(func() { _ = set.SetAutoUpdateCheck(false) })
	if !set.AutoUpdateCheck() {
		t.Error("auto-check did not persist")
	}
}

// SetAutoUpdateCheck applies live (goal 0207): turning it on starts the
// background loop immediately, with no restart -- and turning it off
// stops it, both idempotently.
func TestSetAutoUpdateCheck_AppliesLiveNoRestartRequired(t *testing.T) {
	s := newTestSettingsService(t)

	running := func() bool {
		s.mu.Lock()
		defer s.mu.Unlock()
		return s.autoUpdateLoopCancel != nil
	}
	if running() {
		t.Fatal("loop must not be running before opt-in")
	}

	if err := s.SetAutoUpdateCheck(true); err != nil {
		t.Fatal(err)
	}
	if !running() {
		t.Fatal("SetAutoUpdateCheck(true) must start the loop live")
	}

	// Idempotent start: a second "on" must not panic or replace the
	// running loop with a leaked second one.
	if err := s.SetAutoUpdateCheck(true); err != nil {
		t.Fatal(err)
	}
	if !running() {
		t.Fatal("a redundant SetAutoUpdateCheck(true) must leave the loop running")
	}

	if err := s.SetAutoUpdateCheck(false); err != nil {
		t.Fatal(err)
	}
	if running() {
		t.Fatal("SetAutoUpdateCheck(false) must stop the loop live")
	}

	// Idempotent stop: a second "off" must not panic on a nil cancel.
	if err := s.SetAutoUpdateCheck(false); err != nil {
		t.Fatal(err)
	}
	if running() {
		t.Fatal("a redundant SetAutoUpdateCheck(false) must leave the loop stopped")
	}
}

// StartAutoUpdateChecks (main.go's boot call) starts the loop when the
// preference is already on, unchanged behavior from before goal 0207 --
// it now delegates to the same idempotent entry point the live toggle
// uses.
func TestStartAutoUpdateChecks_StartsTheLoopWhenAlreadyOptedIn(t *testing.T) {
	s := newTestSettingsService(t)
	if err := s.store.Set(autoUpdateCheckKey, true); err != nil {
		t.Fatalf("seed the persisted opt-in: %v", err)
	}

	s.StartAutoUpdateChecks()
	t.Cleanup(s.stopAutoUpdateLoop)

	s.mu.Lock()
	running := s.autoUpdateLoopCancel != nil
	s.mu.Unlock()
	if !running {
		t.Fatal("StartAutoUpdateChecks must start the loop for an already-on preference")
	}
}

// StartAutoUpdateChecks stays a no-op when the preference is off --
// nothing should run in the background for a user who never opted in.
func TestStartAutoUpdateChecks_NoopWhenOptedOut(t *testing.T) {
	s := newTestSettingsService(t)
	s.StartAutoUpdateChecks()

	s.mu.Lock()
	running := s.autoUpdateLoopCancel != nil
	s.mu.Unlock()
	if running {
		t.Fatal("StartAutoUpdateChecks must not start the loop when the preference is off")
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
