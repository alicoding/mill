//go:build !server

package launchatlogin

import (
	"fmt"
	"path/filepath"
	"strings"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// autostartAPI is the slice of *application.AutostartManager this
// package calls. Named as its own interface because AutostartManager
// has no exported constructor that doesn't need a real
// *application.App -- a fake satisfying this interface is the only way
// to unit-test Enable/Disable/Status without standing up a full Wails
// app in the test process.
type autostartAPI interface {
	Enable() error
	Disable() error
	Status() (application.AutostartStatus, error)
}

// manager is wired once from main.go, right after application.New()
// returns -- AutostartManager doesn't exist before then, so this
// follows the same late-bound-setter shape SettingsService.SetWindow
// already uses for the main window.
var manager autostartAPI

// SetAutostartManager wires Enable/Disable/Status's delegate. Must run
// before any of those are called from a real request; nil until then,
// which ErrAutostartNotWired guards rather than a nil dereference.
func SetAutostartManager(mgr *application.AutostartManager) {
	manager = mgr
}

// requiresApproval and retireLegacyItem are indirected through
// package-level vars (Wails' own launchctlBootstrap/launchctlBootout in
// autostart_darwin.go use the identical shape) so tests can stub them,
// and so the non-darwin build simply wires in a no-op instead of an
// #if maze inside this file. Real implementations live in
// launchatlogin_smappservice_darwin.go/_other.go and
// launchatlogin_legacy_darwin.go/_other.go.
var (
	requiresApproval = smAppServiceRequiresApproval
	retireLegacyItem = retireLegacySystemEventsItem
)

// appBundlePath walks up from a running executable's path
// (.../Foo.app/Contents/MacOS/Foo) to the .app bundle itself. Returns
// ErrNotAppBundle if execPath doesn't have that shape -- the guard
// every call below runs first, so login-at-launch stays gated to a
// real installed bundle exactly as it was before this file adopted
// Wails' own AutostartManager.
func appBundlePath(execPath string) (string, error) {
	macOSDir := filepath.Dir(execPath)      // .../Foo.app/Contents/MacOS
	contentsDir := filepath.Dir(macOSDir)   // .../Foo.app/Contents
	bundlePath := filepath.Dir(contentsDir) // .../Foo.app
	if filepath.Base(macOSDir) != "MacOS" || filepath.Base(contentsDir) != "Contents" || filepath.Ext(bundlePath) != ".app" {
		return "", ErrNotAppBundle
	}
	return bundlePath, nil
}

func appName(bundlePath string) string {
	return strings.TrimSuffix(filepath.Base(bundlePath), ".app")
}

// Enable registers execPath's .app bundle to launch at login through
// Wails' AutostartManager, then best-effort retires any login item a
// pre-SMAppService Mill build left behind via System Events (see
// retireLegacySystemEventsItem) -- an upgrading user must end up with
// exactly one registration, not two.
func Enable(execPath string) error {
	bundlePath, err := appBundlePath(execPath)
	if err != nil {
		return err
	}
	if manager == nil {
		return ErrAutostartNotWired
	}
	if err := manager.Enable(); err != nil {
		return fmt.Errorf("autostart enable: %w", err)
	}
	retireLegacyItem(appName(bundlePath))
	return nil
}

// Disable unregisters execPath's .app bundle. Not an error if it
// wasn't registered.
func Disable(execPath string) error {
	if _, err := appBundlePath(execPath); err != nil {
		return err
	}
	if manager == nil {
		return ErrAutostartNotWired
	}
	if err := manager.Disable(); err != nil {
		return fmt.Errorf("autostart disable: %w", err)
	}
	return nil
}

// Status reports execPath's .app bundle's login-item registration:
// Disabled, Enabled, or RequiresApproval -- the state
// AutostartManager.Status() itself cannot report (see this package's
// doc comment), which is the entire reason this package still carries
// platform-specific code beyond what Wails exposes.
func Status(execPath string) (LoginItemStatus, error) {
	if _, err := appBundlePath(execPath); err != nil {
		return LoginItemDisabled, err
	}
	if manager == nil {
		return LoginItemDisabled, ErrAutostartNotWired
	}
	if requiresApproval() {
		return LoginItemRequiresApproval, nil
	}
	st, err := manager.Status()
	if err != nil {
		return LoginItemDisabled, fmt.Errorf("autostart status: %w", err)
	}
	if st.Enabled {
		return LoginItemEnabled, nil
	}
	return LoginItemDisabled, nil
}
