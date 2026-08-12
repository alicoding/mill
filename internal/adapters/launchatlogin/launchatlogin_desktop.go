//go:build !server

package launchatlogin

import (
	"context"
	"fmt"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// osascriptTimeout bounds every osascript invocation below -- same
// fail-safe reasoning as clipboard's own cmdTimeout.
const osascriptTimeout = 5 * time.Second

// appBundlePath walks up from a running executable's path
// (.../Foo.app/Contents/MacOS/Foo) to the .app bundle itself. Returns
// ErrNotAppBundle if execPath doesn't have that shape.
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

// Enable registers execPath's .app bundle as a login item via System
// Events -- standard AppleScript vocabulary, the same mechanism
// System Settings' own "Open at Login" list uses under the hood.
func Enable(execPath string) error {
	bundlePath, err := appBundlePath(execPath)
	if err != nil {
		return err
	}
	script := fmt.Sprintf(
		`tell application "System Events" to make login item at end with properties {path:%q, hidden:false, name:%q}`,
		bundlePath, appName(bundlePath),
	)
	ctx, cancel := context.WithTimeout(context.Background(), osascriptTimeout)
	defer cancel()
	// bundlePath/appName derive from execPath, which callers pass as
	// Mill's own running executable path (os.Executable()), never
	// arbitrary external/user input.
	if out, err := exec.CommandContext(ctx, "osascript", "-e", script).CombinedOutput(); err != nil { //nolint:gosec // script is built from Mill's own executable path, not external input (see comment above)
		return fmt.Errorf("osascript enable login item failed: %w (%s)", err, strings.TrimSpace(string(out)))
	}
	return nil
}

// Disable removes execPath's .app bundle from the login items list, if
// present. Not an error if it wasn't there.
func Disable(execPath string) error {
	bundlePath, err := appBundlePath(execPath)
	if err != nil {
		return err
	}
	script := fmt.Sprintf(`tell application "System Events" to delete login item %q`, appName(bundlePath))
	ctx, cancel := context.WithTimeout(context.Background(), osascriptTimeout)
	defer cancel()
	// System Events errors if the named login item doesn't exist --
	// that's the expected "already disabled" case, not a real failure,
	// so it's deliberately not surfaced as one. script is built from
	// Mill's own executable path (see Enable's own comment above).
	_ = exec.CommandContext(ctx, "osascript", "-e", script).Run() //nolint:gosec // script is built from Mill's own executable path, not external input
	return nil
}

// IsEnabled reports whether execPath's .app bundle is currently
// registered as a login item.
func IsEnabled(execPath string) (bool, error) {
	bundlePath, err := appBundlePath(execPath)
	if err != nil {
		return false, err
	}
	name := appName(bundlePath)
	script := `tell application "System Events" to get the name of every login item`
	ctx, cancel := context.WithTimeout(context.Background(), osascriptTimeout)
	defer cancel()
	out, err := exec.CommandContext(ctx, "osascript", "-e", script).Output()
	if err != nil {
		return false, fmt.Errorf("osascript list login items failed: %w", err)
	}
	for _, item := range strings.Split(strings.TrimSpace(string(out)), ", ") {
		if item == name {
			return true, nil
		}
	}
	return false, nil
}
