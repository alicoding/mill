//go:build server

package idletime

import (
	"errors"
	"time"
)

// ErrUnsupportedInServerMode is returned by Seconds in server mode --
// there is no HID input stream to read regardless of platform, same
// reasoning as internal/adapters/hotkey/notify/dockbadge's own server
// stubs (docs/SPEC.md §1.3).
var ErrUnsupportedInServerMode = errors.New("idle time is not available in server mode")

// Seconds always fails in server mode; see ErrUnsupportedInServerMode.
// Callers (SettingsService.isAway) fail TOWARD treating the user as
// away on this error -- §8's fail-safe posture, docs/goals/0023 item 2.
func Seconds() (time.Duration, error) { return 0, ErrUnsupportedInServerMode }
