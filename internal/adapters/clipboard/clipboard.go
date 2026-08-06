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
