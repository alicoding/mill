//go:build !server

package idletime

import (
	"errors"
	"fmt"
	"os/exec"
	"strconv"
	"strings"
	"time"
)

// Seconds shells out to `ioreg -c IOHIDSystem` -- the same
// shell-out-to-a-real-OS-command pattern internal/adapters/clipboard
// already establishes (osascript/pbcopy/pbpaste), zero cgo -- and reads
// the "HIDIdleTime" counter, which macOS reports in nanoseconds since
// the last local HID event (keyboard/mouse/trackpad) system-wide.
// Confirmed directly (research pass behind docs/adr/0032's Update) that
// this specific ioreg query needs no TCC/Accessibility grant, unlike
// CGEventSourceSecondsSinceLastEventType (which needs the Accessibility
// entitlement Mill only optionally has, docs/SPEC.md §2.2) --
// IOHIDSystem's own idle-time property is plain IORegistry data any
// process can read.
func Seconds() (time.Duration, error) {
	out, err := exec.Command("ioreg", "-c", "IOHIDSystem").Output()
	if err != nil {
		return 0, fmt.Errorf("idletime: ioreg: %w", err)
	}
	return parseIdleTime(string(out))
}

// parseIdleTime extracts the HIDIdleTime value out of a real `ioreg -c
// IOHIDSystem` invocation's output -- split out of Seconds so it's
// independently unit-testable against captured real output
// (idletime_desktop_test.go), no subprocess needed. The line looks like
// `"HIDIdleTime" = 5810802916` -- the value is always the last
// whitespace-separated field on the line carrying the key.
func parseIdleTime(output string) (time.Duration, error) {
	idx := strings.Index(output, "HIDIdleTime")
	if idx == -1 {
		return 0, errors.New("idletime: HIDIdleTime not present in ioreg output")
	}
	line := output[idx:]
	if nl := strings.IndexByte(line, '\n'); nl != -1 {
		line = line[:nl]
	}
	fields := strings.Fields(line)
	if len(fields) == 0 {
		return 0, errors.New("idletime: empty HIDIdleTime line")
	}
	raw := fields[len(fields)-1]
	ns, err := strconv.ParseInt(raw, 10, 64)
	if err != nil {
		return 0, fmt.Errorf("idletime: parse HIDIdleTime %q: %w", raw, err)
	}
	return time.Duration(ns), nil
}
