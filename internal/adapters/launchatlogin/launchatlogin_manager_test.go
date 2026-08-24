//go:build !server

package launchatlogin

import (
	"errors"
	"testing"

	"github.com/wailsapp/wails/v3/pkg/application"
)

const testBundleExe = "/Applications/Mill.app/Contents/MacOS/mill"

// fakeAutostart satisfies autostartAPI without needing a real
// *application.App -- AutostartManager has no exported constructor
// that doesn't need one, so this is the only way to unit-test
// Enable/Disable/Status's own delegation logic.
type fakeAutostart struct {
	enableErr, disableErr, statusErr error
	status                           application.AutostartStatus
	enableCalls, disableCalls        int
}

func (f *fakeAutostart) Enable() error  { f.enableCalls++; return f.enableErr }
func (f *fakeAutostart) Disable() error { f.disableCalls++; return f.disableErr }
func (f *fakeAutostart) Status() (application.AutostartStatus, error) {
	return f.status, f.statusErr
}

// withFakes swaps manager/requiresApproval/retireLegacyItem for the
// duration of one test and restores the real values after -- these are
// package-level vars precisely so tests can do this (same shape Wails'
// own autostart_darwin.go uses for launchctlBootstrap/launchctlBootout).
func withFakes(t *testing.T, fake *fakeAutostart, approval bool) *[]string {
	t.Helper()
	origManager, origApproval, origRetire := manager, requiresApproval, retireLegacyItem
	retired := []string{}
	manager = fake
	requiresApproval = func() bool { return approval }
	retireLegacyItem = func(name string) { retired = append(retired, name) }
	t.Cleanup(func() {
		manager, requiresApproval, retireLegacyItem = origManager, origApproval, origRetire
	})
	return &retired
}

func TestEnable_NotAppBundle_NeverCallsManager(t *testing.T) {
	fake := &fakeAutostart{}
	withFakes(t, fake, false)
	if err := Enable("/tmp/mill-dev-build/bin/mill.dev"); !errors.Is(err, ErrNotAppBundle) {
		t.Fatalf("Enable on a dev binary: err = %v, want ErrNotAppBundle", err)
	}
	if fake.enableCalls != 0 {
		t.Errorf("manager.Enable called %d times, want 0 -- the bundle guard must run first", fake.enableCalls)
	}
}

func TestEnable_NoManagerWired_ErrAutostartNotWired(t *testing.T) {
	origManager := manager
	manager = nil
	t.Cleanup(func() { manager = origManager })
	if err := Enable(testBundleExe); !errors.Is(err, ErrAutostartNotWired) {
		t.Errorf("Enable with no manager wired: err = %v, want ErrAutostartNotWired", err)
	}
}

func TestEnable_Success_RetiresLegacyItemByAppName(t *testing.T) {
	fake := &fakeAutostart{}
	retired := withFakes(t, fake, false)
	if err := Enable(testBundleExe); err != nil {
		t.Fatalf("Enable: %v", err)
	}
	if fake.enableCalls != 1 {
		t.Errorf("manager.Enable called %d times, want 1", fake.enableCalls)
	}
	if got := *retired; len(got) != 1 || got[0] != "Mill" {
		t.Errorf("retireLegacyItem calls = %v, want exactly one call with %q", got, "Mill")
	}
}

func TestEnable_ManagerError_DoesNotRetireLegacyItem(t *testing.T) {
	fake := &fakeAutostart{enableErr: errors.New("registration failed")}
	retired := withFakes(t, fake, false)
	if err := Enable(testBundleExe); err == nil {
		t.Fatal("Enable: want an error when manager.Enable fails")
	}
	if got := *retired; len(got) != 0 {
		t.Errorf("retireLegacyItem calls = %v, want none -- a failed registration must not run cleanup", got)
	}
}

func TestDisable_Success_DelegatesToManager(t *testing.T) {
	fake := &fakeAutostart{}
	withFakes(t, fake, false)
	if err := Disable(testBundleExe); err != nil {
		t.Fatalf("Disable: %v", err)
	}
	if fake.disableCalls != 1 {
		t.Errorf("manager.Disable called %d times, want 1", fake.disableCalls)
	}
}

func TestStatus_RequiresApproval_TakesPriorityOverManagerStatus(t *testing.T) {
	fake := &fakeAutostart{status: application.AutostartStatus{Enabled: false}}
	withFakes(t, fake, true)
	got, err := Status(testBundleExe)
	if err != nil {
		t.Fatalf("Status: %v", err)
	}
	if got != LoginItemRequiresApproval {
		t.Errorf("Status = %q, want %q", got, LoginItemRequiresApproval)
	}
}

func TestStatus_Enabled(t *testing.T) {
	fake := &fakeAutostart{status: application.AutostartStatus{Enabled: true}}
	withFakes(t, fake, false)
	got, err := Status(testBundleExe)
	if err != nil {
		t.Fatalf("Status: %v", err)
	}
	if got != LoginItemEnabled {
		t.Errorf("Status = %q, want %q", got, LoginItemEnabled)
	}
}

func TestStatus_Disabled(t *testing.T) {
	fake := &fakeAutostart{status: application.AutostartStatus{Enabled: false}}
	withFakes(t, fake, false)
	got, err := Status(testBundleExe)
	if err != nil {
		t.Fatalf("Status: %v", err)
	}
	if got != LoginItemDisabled {
		t.Errorf("Status = %q, want %q", got, LoginItemDisabled)
	}
}

func TestStatus_NotAppBundle_ErrNotAppBundle(t *testing.T) {
	withFakes(t, &fakeAutostart{}, false)
	if _, err := Status("/tmp/mill-dev-build/bin/mill.dev"); !errors.Is(err, ErrNotAppBundle) {
		t.Errorf("Status on a dev binary: err = %v, want ErrNotAppBundle", err)
	}
}
