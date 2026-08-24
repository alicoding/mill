//go:build darwin && !server

package launchatlogin

import (
	"context"
	"fmt"
	"os/exec"
	"time"
)

// legacyRetireTimeout bounds the one osascript invocation this package
// still makes -- same fail-safe reasoning as clipboard's own
// cmdTimeout, kept narrow to this single migration call rather than the
// general-purpose timeout the old System-Events-backed Enable/Disable/
// IsEnabled used to share.
const legacyRetireTimeout = 5 * time.Second

// retireLegacySystemEventsItem best-effort removes a login item a
// pre-SMAppService Mill build registered via System Events' AppleScript
// vocabulary ("make login item"). No Service Management or Shared File
// List API can reach an item added that way once an app has moved to
// SMAppService: confirmed against Apple Developer Forums thread 713830,
// where an Apple DTS engineer, asked this exact question, states there
// is no supported removal path for a pre-13 login item once the app
// has switched to SMAppService.register(). This is the one narrow,
// bounded osascript call this package still makes, kept solely for
// that one-time upgrade cleanup -- every standing enable/disable/status
// path goes through SMAppService/AutostartManager instead.
//
// A failure here (denied Automation permission, item already gone) is
// silently swallowed: it must never block the new SMAppService
// registration Enable already committed, which needs no such
// permission at all.
func retireLegacySystemEventsItem(name string) {
	script := fmt.Sprintf(`tell application "System Events" to delete login item %q`, name)
	ctx, cancel := context.WithTimeout(context.Background(), legacyRetireTimeout)
	defer cancel()
	// name derives from Mill's own running executable's bundle name
	// (appName), never external/user input.
	_ = exec.CommandContext(ctx, "osascript", "-e", script).Run() //nolint:gosec // script is built from Mill's own bundle name, not external input
}
