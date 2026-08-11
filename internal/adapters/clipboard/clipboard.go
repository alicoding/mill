// Package clipboard wraps macOS clipboard I/O behind Mill's own names, so
// swapping the underlying mechanism (osascript today) never touches domain
// logic — the CLAUDE.md ports/adapters rule applied to this one commodity
// concern.
package clipboard

import (
	"encoding/hex"
	"fmt"
	"os/exec"
	"strings"
	"time"
)

// ReadHTML asks macOS for the HTML flavor of the current clipboard
// contents. AppleScript returns raw AppleEvent data as a hex-encoded
// "«data HTMLxxxx»" literal, so it needs unwrapping before it's usable HTML.
func ReadHTML() (string, error) {
	out, err := exec.Command("osascript", "-e", "the clipboard as «class HTML»").Output()
	if err != nil {
		return "", fmt.Errorf("no HTML on clipboard: %w", err)
	}

	raw := strings.TrimSpace(string(out))
	raw = strings.TrimPrefix(raw, "«data HTML")
	raw = strings.TrimSuffix(raw, "»")

	decoded, err := hex.DecodeString(raw)
	if err != nil {
		return "", fmt.Errorf("could not decode clipboard HTML: %w", err)
	}
	return string(decoded), nil
}

// WriteHTML is the inverse of ReadHTML: AppleScript sets the clipboard's
// HTML flavor from a hex-encoded "«data HTMLxxxx»" literal, the same
// encoding it hands back when reading.
func WriteHTML(html string) error {
	script := "set the clipboard to «data HTML" + hex.EncodeToString([]byte(html)) + "»"
	if err := exec.Command("osascript", "-e", script).Run(); err != nil {
		return fmt.Errorf("osascript set-clipboard failed: %w", err)
	}
	return nil
}

// WriteText sets the clipboard's plain-text flavor via pbcopy.
func WriteText(text string) error {
	cmd := exec.Command("pbcopy")
	cmd.Stdin = strings.NewReader(text)
	return cmd.Run()
}

// ReadText reads the clipboard's plain-text flavor via pbpaste.
func ReadText() (string, error) {
	out, err := exec.Command("pbpaste").Output()
	if err != nil {
		return "", fmt.Errorf("pbpaste failed: %w", err)
	}
	return string(out), nil
}

// Info returns macOS's own raw "clipboard info" report -- a
// comma-separated list of alternating «class XXXX», byte-size pairs
// naming every flavor currently on the pasteboard (e.g. "«class
// utf8», 12, «class HTML», 14"). Unlike ReadHTML/ReadText, which each
// commit to one flavor and fail if it's absent, this is a diagnostic:
// "what's actually on the clipboard right now, and in what shapes" --
// the same «class HTML»/plain-text presence question §5's capture
// fallback order already has to answer implicitly, made directly
// inspectable.
func Info() (string, error) {
	out, err := exec.Command("osascript", "-e", "clipboard info").Output()
	if err != nil {
		return "", fmt.Errorf("clipboard info failed: %w", err)
	}
	return strings.TrimSpace(string(out)), nil
}

// WatchChanges polls the clipboard's plain-text flavor on the given
// interval and calls fn whenever it differs from the last-seen value.
// Build, not adopt -- confirmed no clipboard-changed event exists via
// osascript (docs/SPEC.md §3.4), so this is the same poll-loop shape
// every clipboard manager uses under the hood. Plain text, not HTML: the
// HTML flavor is frequently absent (e.g. copying a filename or plain
// text produces none, and ReadHTML errors in that case), so watching it
// would miss most real clipboard activity -- text is the one flavor
// almost everything copyable sets.
func WatchChanges(interval time.Duration, fn func()) (stop func()) {
	done := make(chan struct{})
	go func() {
		last, _ := ReadText() // baseline; ignore error (nothing on clipboard yet)
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				text, err := ReadText()
				if err != nil {
					continue
				}
				if text != last {
					last = text
					fn()
				}
			case <-done:
				return
			}
		}
	}()
	return func() { close(done) }
}
